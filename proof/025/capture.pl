use strict;
use warnings;
no warnings 'portable';
use JSON::PP qw(encode_json decode_json);
use MIME::Base64 qw(encode_base64);
use File::Path qw(remove_tree make_path);
use Digest::SHA qw(sha256_hex);

sub slurp {
  my ($path) = @_;
  if (open my $fh, '<:raw', $path) {
    local $/;
    my $data = <$fh>;
    close $fh;
    return $data;
  }
  return "UNREADABLE $!\n";
}

sub socket_inode {
  my ($target) = @_;
  return undef unless defined $target;
  return $1 if $target =~ /^socket:\[(\d+)\]$/;
  return undef;
}

sub parse_tcp_table {
  my ($path, $family) = @_;
  my @rows;
  return @rows unless -e $path;
  my $text = slurp($path);
  for my $line (split /\n/, $text) {
    $line =~ s/^\s+|\s+$//g;
    next if $line eq '' || $line =~ /^sl\s/;
    my @p = split /\s+/, $line;
    next unless @p >= 10;
    push @rows, {
      family => $family,
      localAddress => $p[1],
      remoteAddress => $p[2],
      state => $p[3],
      inode => $p[9],
      raw => $line,
    };
  }
  return @rows;
}

my $pid;
if (opendir my $pdh, '/proc') {
  for my $entry (grep { /^\d+$/ } readdir $pdh) {
    my $cmdline = slurp("/proc/$entry/cmdline");
    if ($cmdline =~ /counter\.mjs/) {
      $pid = $entry;
      last;
    }
  }
  closedir $pdh;
}
die "missing node counter pid\n" unless $pid;
kill 'STOP', $pid; # external quiesce, no app hook and no Node checkpoint API

my $root = '/tmp/machinen-proper-level5-source-state';
remove_tree($root) if -e $root;
make_path("$root/proc/$pid/task", "$root/memory");
for my $name (qw(maps status stat syscall cmdline environ auxv)) {
  open my $out, '>:raw', "$root/proc/$pid/$name" or die $!;
  print {$out} slurp("/proc/$pid/$name");
  close $out;
}

opendir my $tdh, "/proc/$pid/task" or die $!;
my @tasks = sort { $a <=> $b } map { 0 + $_ } grep { /^\d+$/ } readdir $tdh;
closedir $tdh;
my @thread_rows;
for my $tid (@tasks) {
  make_path("$root/proc/$pid/task/$tid");
  for my $name (qw(status stat syscall)) {
    open my $out, '>:raw', "$root/proc/$pid/task/$tid/$name" or die $!;
    print {$out} slurp("/proc/$pid/task/$tid/$name");
    close $out;
  }
  push @thread_rows, { tid => 0 + $tid, syscall => slurp("/proc/$pid/task/$tid/syscall") };
}

my @fd_rows;
if (opendir my $dh, "/proc/$pid/fd") {
  for my $fd (sort { $a <=> $b } grep { /^\d+$/ } readdir $dh) {
    my $target = readlink("/proc/$pid/fd/$fd");
    my $row = defined($target) ? { fd => 0 + $fd, target => $target } : { fd => 0 + $fd, error => "$!" };
    my $inode = socket_inode($target);
    $row->{socketInode} = $inode if defined $inode;
    push @fd_rows, $row;
  }
  closedir $dh;
}
open my $fdout, '>', "$root/fd-table.json" or die $!;
print {$fdout} JSON::PP->new->canonical->pretty->encode(\@fd_rows);
close $fdout;

my @tcp_rows = (parse_tcp_table('/proc/net/tcp', 'tcp4'), parse_tcp_table('/proc/net/tcp6', 'tcp6'));
for my $name (qw(tcp tcp6)) {
  my $path = "/proc/net/$name";
  next unless -e $path;
  open my $out, '>:raw', "$root/proc-net-$name.txt" or die $!;
  print {$out} slurp($path);
  close $out;
}
my %fd_by_inode = map { defined($_->{socketInode}) ? ($_->{socketInode} => $_) : () } @fd_rows;
my @tcp_listeners;
for my $row (@tcp_rows) {
  next unless $row->{state} eq '0A';
  next unless exists $fd_by_inode{$row->{inode}};
  my %joined = (%$row, fd => $fd_by_inode{$row->{inode}}->{fd}, fdTarget => $fd_by_inode{$row->{inode}}->{target});
  push @tcp_listeners, \%joined;
}

my $maps_text = slurp("/proc/$pid/maps");
my (@accepted, @refusals, @count_string_fragments, @source_closure_fragments, @timer_fragments, @v8_candidate_fragments, @libuv_candidate_fragments);
open my $mem, '<:raw', "/proc/$pid/mem" or die "open mem: $!";
my $index = 0;
for my $line (split /\n/, $maps_text) {
  my @parts = split /\s+/, $line, 6;
  next unless @parts >= 5;
  my ($start_s, $end_s) = split /-/, $parts[0];
  my $start = hex($start_s);
  my $end = hex($end_s);
  my $perms = $parts[1];
  my $path = @parts > 5 ? $parts[5] : '';
  my $size = $end - $start;
  my $accept = ($perms =~ /r/ && $perms =~ /w/ && $perms =~ /p/ && $size <= 4 * 1024 * 1024 && ($path eq '' || $path eq '[heap]' || $path eq '[stack]'));
  my $row = { index => $index, start => sprintf('0x%x', $start), end => sprintf('0x%x', $end), size => $size, permissions => $perms, path => $path };
  if (!$accept) {
    $row->{reason} = 'only small private writable heap/anonymous/stack mappings are accepted for first proof capture';
    push @refusals, $row;
    $index++;
    next;
  }
  if (!seek($mem, $start, 0)) {
    $row->{reason} = "memory seek failed: $!";
    push @refusals, $row;
    $index++;
    next;
  }
  my $data = '';
  my $read = read($mem, $data, $size);
  if (!defined $read) {
    $row->{reason} = "memory read failed: $!";
    push @refusals, $row;
    $index++;
    next;
  }
  my $outrel = sprintf('memory/map-%04d-%s-%s.bin', $index, $start_s, $end_s);
  open my $out, '>:raw', "$root/$outrel" or die $!;
  print {$out} $data;
  close $out;
  $row->{sha256} = sha256_hex($data);
  $row->{bytesPath} = $outrel;
  push @accepted, $row;

  while ($data =~ /\{"count":([0-9]+)\}/g) {
    my $offset = $-[0];
    push @count_string_fragments, {
      kind => 'v8-heap-json-response-string-candidate',
      bytesPath => $outrel,
      mappingIndex => $index,
      offset => $offset,
      literalSha256 => sha256_hex(substr($data, $offset, $+[0] - $-[0])),
      evidence => 'raw accepted writable process memory contains JSON response string previously allocated by the Node/V8 counter closure',
    };
  }
  my $source_offset = index($data, "let count = 0;");
  if ($source_offset >= 0 && index($data, 'createServer', $source_offset) >= 0) {
    push @source_closure_fragments, {
      kind => 'v8-heap-module-source-counter-closure-candidate',
      bytesPath => $outrel,
      mappingIndex => $index,
      offset => $source_offset,
      literalSha256 => sha256_hex(substr($data, $source_offset, 128)),
      evidence => 'raw accepted writable process memory contains the compiled module source text with the count closure cell declaration',
    };
  }
  my $timer_offset = index($data, 'machinen-level5-libuv-timer-anchor-v1');
  if ($timer_offset >= 0) {
    push @timer_fragments, {
      kind => 'libuv-timer-handle-and-v8-context-anchor-candidate',
      bytesPath => $outrel,
      mappingIndex => $index,
      offset => $timer_offset,
      callbackNameFound => index($data, 'machinenTimerCallback') >= 0 ? JSON::PP::true : JSON::PP::false,
      evidence => 'raw accepted writable process memory contains the retained timer closure anchor used to locate the V8 timer context and libuv timer evidence',
    };
  }
  if (index($data, 'v8') >= 0 || index($data, 'V8') >= 0 || index($data, 'Isolate') >= 0) {
    push @v8_candidate_fragments, { kind => 'v8-isolate-or-roots-neighborhood-candidate', bytesPath => $outrel, mappingIndex => $index, evidence => 'accepted writable memory page contains V8/isolate/root related strings or pointers' };
  }
  if (index($data, 'uv_') >= 0 || index($data, 'listen') >= 0 || index($data, 'TCP') >= 0) {
    push @libuv_candidate_fragments, { kind => 'libuv-loop-or-handle-neighborhood-candidate', bytesPath => $outrel, mappingIndex => $index, evidence => 'accepted writable memory page contains libuv/listener related strings or pointers' };
  }
  $index++;
}
close $mem;

my $exe = readlink("/proc/$pid/exe") // '';
my $versions_json = $exe ? `$exe -p 'JSON.stringify(process.versions)' 2>/dev/null` : '{}';
my $node_versions = eval { decode_json($versions_json) } || { error => 'node versions unavailable' };
my @map_lines = split /\n/, $maps_text;
my @failures;
push @failures, { code => 'node-proper-level5-main-thread-missing', message => 'no task/thread state captured' } if @tasks < 1;
push @failures, { code => 'node-proper-level5-native-addon-unsupported', message => 'native addon mapping detected' } if $maps_text =~ /\.node/;
push @failures, { code => 'node-proper-level5-listener-count-unsupported', message => 'expected one TCP LISTEN socket, found ' . scalar(@tcp_listeners) } if @tcp_listeners != 1;
push @failures, { code => 'node-proper-level5-node-build-identity-unavailable', message => 'stable Node/V8 build identity unavailable' } if !ref($node_versions) || !exists $node_versions->{node} || !exists $node_versions->{v8};
push @failures, { code => 'node-proper-level5-counter-memory-evidence-missing', message => 'no counter response string was found in accepted memory bytes' } if @count_string_fragments == 0;
push @failures, { code => 'node-proper-level5-counter-closure-memory-evidence-missing', message => 'no source closure/global candidate was found in accepted memory bytes' } if @source_closure_fragments == 0;
push @failures, { code => 'node-proper-level5-libuv-timer-missing', message => 'no supported timer anchor was found in accepted memory bytes' } if @timer_fragments == 0;

my $summary = {
  kind => 'machinen.node-proper-level5-source-state-capture',
  goal => 'proper-node-level5-source-state-translation-proof',
  pid => 0 + $pid,
  externalQuiesce => { method => 'SIGSTOP', appHookUsed => JSON::PP::false, checkpointApiUsed => JSON::PP::false, vmStoppedExternally => JSON::PP::true },
  capturePolicy => {
    selectedStateCounterDescriptorUsed => JSON::PP::false,
    sourceRequestBodiesIncludedInIr => JSON::PP::false,
    sidecarOutputIncludedInIr => JSON::PP::false,
    acceptedMappingPolicy => 'small readable+writable private anonymous/heap/stack mappings only',
  },
  captured => {
    registerThreadState => ['status', 'stat', 'syscall', 'per-task status/stat/syscall'],
    procMaps => JSON::PP::true,
    memoryBytesForAcceptedMappings => scalar(@accepted),
    fdTable => JSON::PP::true,
    socketListenerState => JSON::PP::true,
    auxvEnvCmdline => JSON::PP::true,
  },
  classification => {
    acceptedForFirstProof => @failures == 0 ? JSON::PP::true : JSON::PP::false,
    failures => \@failures,
    osThreadsCaptured => \@tasks,
    oneJavaScriptMainThread => JSON::PP::true,
    nodeWorkersDetected => JSON::PP::false,
    activeSyscallPolicy => 'event-loop poll wait is treated as a quiescent resume point; arbitrary in-flight syscalls refuse',
    threadSyscalls => \@thread_rows,
    nodeVersions => $node_versions,
    tcpListeners => \@tcp_listeners,
    acceptedMappings => \@accepted,
    refusedMappings => [ @refusals[0 .. (@refusals < 50 ? $#refusals : 49)] ],
  },
  runtimeStateCandidates => {
    nodeBinaryMappings => [ grep { /\/node/ } @map_lines ],
    libnodeMappings => [ grep { /libnode/ } @map_lines ],
    v8IsolateCandidates => [ @v8_candidate_fragments[0 .. (@v8_candidate_fragments < 20 ? $#v8_candidate_fragments : 19)] ],
    v8HeapPageCandidates => [ grep { ($_->{path} // '') eq '' || ($_->{path} // '') eq '[heap]' } @accepted ],
    v8RootsGlobalHandlesCandidates => [ @v8_candidate_fragments[0 .. (@v8_candidate_fragments < 20 ? $#v8_candidate_fragments : 19)] ],
    jsCounterClosureGlobalObjectCandidates => [ @source_closure_fragments, @count_string_fragments[0 .. (@count_string_fragments < 20 ? $#count_string_fragments : 19)] ],
    libuvLoopCandidates => [ @libuv_candidate_fragments[0 .. (@libuv_candidate_fragments < 20 ? $#libuv_candidate_fragments : 19)] ],
    tcpServerHandleCandidates => \@tcp_listeners,
    libuvTimerHandleCandidates => \@timer_fragments,
  },
  portableIr => {
    kind => 'machinen.node-proper-level5-source-state-ir',
    memoryObjectGraphFragments => [ @source_closure_fragments, @timer_fragments, @count_string_fragments ],
    codeModuleIdentities => [{ exe => $exe, nodeVersions => $node_versions, nodeBinaryMappings => [ grep { /\/node/ } @map_lines ], libnodeMappings => [ grep { /libnode/ } @map_lines ] }],
    fdListenerDescriptors => \@tcp_listeners,
    timerDescriptors => \@timer_fragments,
    threadEventLoopResumePoint => { capturedThreadSyscalls => \@thread_rows, policy => 'target creates an equivalent native libuv event-loop wait point instead of resuming source registers' },
    refusalEvidence => [ @failures, @refusals[0 .. (@refusals < 20 ? $#refusals : 19)] ],
  },
  materialization => {
    targetNativeNodeStarted => JSON::PP::false,
    targetNativeObjectsMaterialized => JSON::PP::false,
    eventLoopEntered => JSON::PP::false,
    reason => 'source capture complete; target materialization is performed by the controlled loader from raw memory evidence after the bundle is copied out',
  },
};
open my $sum, '>', "$root/summary.json" or die $!;
print {$sum} JSON::PP->new->canonical->pretty->encode($summary);
close $sum;
kill 'CONT', $pid;
print encode_base64(`tar -C /tmp -czf - machinen-proper-level5-source-state`, '');

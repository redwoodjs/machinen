# @machinen/runtime

## Contents

### Boot a VM

- [`boot`](#boot)
- [`BootOptions`](#bootoptions)
- [`attach`](#attach)
- [`AttachOptions`](#attachoptions)
- [`bootPty`](#bootpty)
- [`PtyBootOptions`](#ptybootoptions)
- [`PtyVmHandle`](#ptyvmhandle)
- [`VmHandle`](#vmhandle)
- [`ImageConfig`](#imageconfig)
- [`autoSizeMemoryMib`](#autosizememorymib)
- [`resolveVmmBinary`](#resolvevmmbinary)
- [`warmImageConfigCache`](#warmimageconfigcache)
- [`measureFirstByte`](#measurefirstbyte)

### Run code in a VM

- [`VsockExec`](#vsockexec)
- [`VsockExecOptions`](#vsockexecoptions)
- [`VsockExecResult`](#vsockexecresult)
- [`VsockExecPtyHandle`](#vsockexecptyhandle)
- [`VsockExecPtyOptions`](#vsockexecptyoptions)
- [`VsockExecPtyResult`](#vsockexecptyresult)

### Snapshot, restore, fork

- [`restore`](#restore)
- [`RestoreOptions`](#restoreoptions)
- [`ForkOptions`](#forkoptions)
- [`SnapshotOptions`](#snapshotoptions)
- [`SnapshotResult`](#snapshotresult)
- [`SnapshotFileIdentity`](#snapshotfileidentity)
- [`SnapshotMeta`](#snapshotmeta)
- [`VmstateBackend`](#vmstatebackend)
- [`VmstateSnapshotMeta`](#vmstatesnapshotmeta)
- [`SnapshotEngine`](#snapshotengine)
- [`bootSnapshotPath`](#bootsnapshotpath)
- [`writeBootSnapshot`](#writebootsnapshot)
- [`detachedLogRoot`](#detachedlogroot)

### Provision base images

- [`provision`](#provision)
- [`ProvisionOptions`](#provisionoptions)
- [`ProvisionResult`](#provisionresult)
- [`resolveBaseDtb`](#resolvebasedtb)
- [`resolveBaseKernel`](#resolvebasekernel)
- [`resolveBaseRootfs`](#resolvebaserootfs)
- [`ensureRootfsImage`](#ensurerootfsimage)
- [`EnsureRootfsImageOptions`](#ensurerootfsimageoptions)
- [`markRootfsImageClean`](#markrootfsimageclean)
- [`rootfsImgCacheDir`](#rootfsimgcachedir)
- [`resolveMke2fs`](#resolvemke2fs)

### Mount files

- [`VsockFiles`](#vsockfiles)
- [`VsockFilesOptions`](#vsockfilesoptions)
- [`WriteFileOptions`](#writefileoptions)
- [`buildWriteFileCmd`](#buildwritefilecmd)
- [`buildWriteFileCmds`](#buildwritefilecmds)
- [`ensureMountDiskImage`](#ensuremountdiskimage)
- [`ensureMountDiskUpper`](#ensuremountdiskupper)
- [`markMountDiskImageClean`](#markmountdiskimageclean)
- [`mountdiskImgCacheDir`](#mountdiskimgcachedir)
- [`resolveMksquashfs`](#resolvemksquashfs)
- [`EnsureMountDiskImageOptions`](#ensuremountdiskimageoptions)
- [`EnsureMountDiskImageResult`](#ensuremountdiskimageresult)
- [`EnsureMountDiskUpperOptions`](#ensuremountdiskupperoptions)
- [`EnsureMountDiskUpperResult`](#ensuremountdiskupperresult)

### Share secrets

- [`VsockSecrets`](#vsocksecrets)
- [`VsockSecretsOptions`](#vsocksecretsoptions)

### Terminal control

- [`VsockWinsize`](#vsockwinsize)
- [`VsockWinsizeOptions`](#vsockwinsizeoptions)

### Manage running VMs

- [`list`](#list)
- [`registryRoot`](#registryroot)
- [`RegistryEntry`](#registryentry)
- [`runGc`](#rungc)
- [`GcResult`](#gcresult)
- [`RunGcOptions`](#rungcoptions)
- [`validatePid`](#validatepid)
- [`PidStatus`](#pidstatus)

### Multiplex sandboxes

- [`Sandboxes`](#sandboxes)
- [`Supervisor`](#supervisor)
- [`SandboxEntry`](#sandboxentry)
- [`OnOutputListener`](#onoutputlistener)
- [`SupervisorOptions`](#supervisoroptions)

### Memory introspection

- [`MemoryStats`](#memorystats)
- [`checkForkBackpressure`](#checkforkbackpressure)
- [`CheckForkBackpressureOptions`](#checkforkbackpressureoptions)
- [`DEFAULT_FREE_MEMORY_THRESHOLD`](#default_free_memory_threshold)
- [`readHostFreeBytes`](#readhostfreebytes)
- [`readHostTotalBytes`](#readhosttotalbytes)
- [`readHostRssBytes`](#readhostrssbytes)
- [`readHostRssBytesMulti`](#readhostrssbytesmulti)
- [`RssTarget`](#rsstarget)
- [`readBalloonStats`](#readballoonstats)
- [`BalloonCounters`](#ballooncounters)
- [`STATS_FILE_SIZE`](#stats_file_size)

### Logging

- [`ChunkLogEvent`](#chunklogevent)
- [`LogEvent`](#logevent)
- [`OnLog`](#onlog)
- [`PhaseLogEvent`](#phaselogevent)

### Runtime adapters (experimental)

- [`RUNTIME_ADAPTER_BUNDLE_FILE`](#runtime_adapter_bundle_file)
- [`RuntimeAdapterValidationError`](#runtimeadaptervalidationerror)
- [`NodeRuntimeAdapterUnsupportedError`](#noderuntimeadapterunsupportederror)
- [`NODE_RUNTIME_NATIVE_RESOURCE_KINDS`](#node_runtime_native_resource_kinds)
- [`captureNodeRuntimeAdapterDocument`](#capturenoderuntimeadapterdocument)
- [`restoreNodeRuntimeAdapterRoots`](#restorenoderuntimeadapterroots)
- [`collectNodeRuntimeAdapterRefusals`](#collectnoderuntimeadapterrefusals)
- [`captureNodeNativeResources`](#capturenodenativeresources)
- [`restoreNodeCapturedResourceRecipes`](#restorenodecapturedresourcerecipes)
- [`captureNodeAsyncContinuations`](#capturenodeasynccontinuations)
- [`restoreNodeAsyncContinuations`](#restorenodeasynccontinuations)
- [`captureJsBuildIdentity`](#capturejsbuildidentity)
- [`verifyJsBuildIdentity`](#verifyjsbuildidentity)
- [`probeBunRuntimeAdapter`](#probebunruntimeadapter)
- [`inspectBunPackagedExecutable`](#inspectbunpackagedexecutable)
- [`CaptureNodeRuntimeAdapterOptions`](#capturenoderuntimeadapteroptions)
- [`CaptureNodeNativeResourcesOptions`](#capturenodenativeresourcesoptions)
- [`NodeRuntimeAdapterResourceKind`](#noderuntimeadapterresourcekind)
- [`NodeRuntimeFileResource`](#noderuntimefileresource)
- [`NodeRuntimeNativeHandleRefusal`](#noderuntimenativehandlerefusal)
- [`RestoredNodeResourceRecipes`](#restorednoderesourcerecipes)
- [`NodeAsyncContinuationKind`](#nodeasynccontinuationkind)
- [`NodeAsyncContinuationInput`](#nodeasynccontinuationinput)
- [`NodeAsyncContinuationRecord`](#nodeasynccontinuationrecord)
- [`NodeAsyncContinuationState`](#nodeasynccontinuationstate)
- [`NodeAsyncContinuationHandlers`](#nodeasynccontinuationhandlers)
- [`RestoredNodeAsyncContinuation`](#restorednodeasynccontinuation)
- [`CaptureJsBuildIdentityOptions`](#capturejsbuildidentityoptions)
- [`JsBuildIdentityFile`](#jsbuildidentityfile)
- [`JsBuildIdentitySidecar`](#jsbuildidentitysidecar)
- [`JsBuildIdentityVerification`](#jsbuildidentityverification)
- [`ProbeBunRuntimeAdapterOptions`](#probebunruntimeadapteroptions)
- [`BunPackagedExecutableIdentity`](#bunpackagedexecutableidentity)
- [`BunRuntimeAdapterProbe`](#bunruntimeadapterprobe)
- [`runtimeAdapterRefusalCodes`](#runtimeadapterrefusalcodes)
- [`runtimeAdapterSchemas`](#runtimeadapterschemas)
- [`validateRuntimeAdapterDocument`](#validateruntimeadapterdocument)
- [`assertRuntimeAdapterDocument`](#assertruntimeadapterdocument)
- [`RuntimeAdapterDocument`](#runtimeadapterdocument)
- [`RuntimeAdapterDescriptor`](#runtimeadapterdescriptor)
- [`RuntimeAdapterEntrypoint`](#runtimeadapterentrypoint)
- [`RuntimeAdapterEntrypoints`](#runtimeadapterentrypoints)
- [`RuntimeAdapterTarget`](#runtimeadaptertarget)
- [`RuntimeAdapterRuntime`](#runtimeadapterruntime)
- [`RuntimeAdapterSerializerCompatibility`](#runtimeadapterserializercompatibility)
- [`RuntimeAdapterBuild`](#runtimeadapterbuild)
- [`RuntimeAdapterBuildIdentity`](#runtimeadapterbuildidentity)
- [`RuntimeAdapterBuildModule`](#runtimeadapterbuildmodule)
- [`RuntimeAdapterProcess`](#runtimeadapterprocess)
- [`RuntimeAdapterGraph`](#runtimeadaptergraph)
- [`RuntimeAdapterRoot`](#runtimeadapterroot)
- [`RuntimeAdapterValue`](#runtimeadaptervalue)
- [`RuntimeAdapterObjectNode`](#runtimeadapterobjectnode)
- [`RuntimeAdapterMapEntry`](#runtimeadaptermapentry)
- [`RuntimeAdapterIdentityAssertion`](#runtimeadapteridentityassertion)
- [`RuntimeAdapterResources`](#runtimeadapterresources)
- [`RuntimeAdapterResource`](#runtimeadapterresource)
- [`RuntimeAdapterResourceRecipe`](#runtimeadapterresourcerecipe)
- [`RuntimeAdapterRestoreContract`](#runtimeadapterrestorecontract)
- [`RuntimeAdapterBundleMapping`](#runtimeadapterbundlemapping)
- [`RuntimeAdapterBundleObjectMapping`](#runtimeadapterbundleobjectmapping)
- [`RuntimeAdapterBundleResourceMapping`](#runtimeadapterbundleresourcemapping)
- [`RuntimeAdapterUnsupportedVocabulary`](#runtimeadapterunsupportedvocabulary)
- [`RuntimeAdapterRefusal`](#runtimeadapterrefusal)
- [`RuntimeAdapterRefusalCode`](#runtimeadapterrefusalcode)
- [`RuntimeAdapterArch`](#runtimeadapterarch)
- [`RuntimeAdapterRuntimeName`](#runtimeadapterruntimename)
- [`RuntimeAdapterTransport`](#runtimeadaptertransport)
- [`RuntimeAdapterValueKind`](#runtimeadaptervaluekind)
- [`RuntimeAdapterObjectKind`](#runtimeadapterobjectkind)
- [`RuntimeAdapterResourceKind`](#runtimeadapterresourcekind)
- [`RuntimeAdapterResourceState`](#runtimeadapterresourcestate)
- [`RuntimeAdapterModuleKind`](#runtimeadaptermodulekind)
- [`RuntimeAdapterMappingRole`](#runtimeadaptermappingrole)
- [`RuntimeAdapterJsonSchema`](#runtimeadapterjsonschema)

### Initramfs (advanced)

- [`mkinitramfsBundle`](#mkinitramfsbundle)
- [`mkinitramfsTinyBundle`](#mkinitramfstinybundle)
- [`mkinitramfsRootfs`](#mkinitramfsrootfs)
- [`mkinitramfsWorkspace`](#mkinitramfsworkspace)
- [`mkinitramfsMinimal`](#mkinitramfsminimal)
- [`mkinitramfsCli`](#mkinitramfscli)
- [`PackBundleOptions`](#packbundleoptions)
- [`PackTinyBundleOptions`](#packtinybundleoptions)
- [`PackRootfsOptions`](#packrootfsoptions)
- [`PackMinimalOptions`](#packminimaloptions)
- [`PackWorkspaceOptions`](#packworkspaceoptions)

### Errors

- [`MachinenError`](#machinenerror)
- [`BootError`](#booterror)
- [`ExecError`](#execerror)
- [`SnapshotError`](#snapshoterror)
- [`ProvisionError`](#provisionerror)
- [`RegistryError`](#registryerror)
- [`FilesError`](#fileserror)
- [`MountError`](#mounterror)
- [`SecretsError`](#secretserror)
- [`WinsizeError`](#winsizeerror)
- [`SandboxError`](#sandboxerror)
- [`CacheError`](#cacheerror)
- [`GvproxyError`](#gvproxyerror)
- [`MkinitramfsError`](#mkinitramfserror)
- [`ParseError`](#parseerror)
- [`ErrorCode`](#errorcode)
- [`MachinenErrorOptions`](#machinenerroroptions)
- [`isMachinenError`](#ismachinenerror)
- [`formatMachinenError`](#formatmachinenerror)

### Internal

- [`_internal`](#_internal)


## Classes

### MachinenError

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- `Error`

#### Extended by

- [`BootError`](#booterror)
- [`ExecError`](#execerror)
- [`SnapshotError`](#snapshoterror)
- [`ProvisionError`](#provisionerror)
- [`RegistryError`](#registryerror)
- [`FilesError`](#fileserror)
- [`MountError`](#mounterror)
- [`SecretsError`](#secretserror)
- [`WinsizeError`](#winsizeerror)
- [`SandboxError`](#sandboxerror)
- [`CacheError`](#cacheerror)
- [`GvproxyError`](#gvproxyerror)
- [`MkinitramfsError`](#mkinitramfserror)
- [`ParseError`](#parseerror)

#### Constructors

##### Constructor

> **new MachinenError**(`code`, `message`, `opts?`): [`MachinenError`](#machinenerror)

###### Parameters

###### code

[`ErrorCode`](#errorcode-1)

###### message

`string`

###### opts?

[`MachinenErrorOptions`](#machinenerroroptions) = `{}`

###### Returns

[`MachinenError`](#machinenerror)

###### Overrides

`Error.constructor`

#### Properties

##### code

> `readonly` **code**: [`ErrorCode`](#errorcode-1)

##### retryable

> `readonly` **retryable**: `boolean`

***

### BootError

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new BootError**(`code`, `message`, `opts?`): [`BootError`](#booterror)

###### Parameters

###### code

[`ErrorCode`](#errorcode-1)

###### message

`string`

###### opts?

[`MachinenErrorOptions`](#machinenerroroptions) = `{}`

###### Returns

[`BootError`](#booterror)

###### Inherited from

[`MachinenError`](#machinenerror).[`constructor`](#constructor)

#### Properties

##### code

> `readonly` **code**: [`ErrorCode`](#errorcode-1)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### ExecError

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new ExecError**(`code`, `message`, `opts?`): [`ExecError`](#execerror)

###### Parameters

###### code

[`ErrorCode`](#errorcode-1)

###### message

`string`

###### opts?

[`MachinenErrorOptions`](#machinenerroroptions) = `{}`

###### Returns

[`ExecError`](#execerror)

###### Inherited from

[`MachinenError`](#machinenerror).[`constructor`](#constructor)

#### Properties

##### code

> `readonly` **code**: [`ErrorCode`](#errorcode-1)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### SnapshotError

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new SnapshotError**(`code`, `message`, `opts?`): [`SnapshotError`](#snapshoterror)

###### Parameters

###### code

[`ErrorCode`](#errorcode-1)

###### message

`string`

###### opts?

[`MachinenErrorOptions`](#machinenerroroptions) = `{}`

###### Returns

[`SnapshotError`](#snapshoterror)

###### Inherited from

[`MachinenError`](#machinenerror).[`constructor`](#constructor)

#### Properties

##### code

> `readonly` **code**: [`ErrorCode`](#errorcode-1)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### ProvisionError

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new ProvisionError**(`code`, `message`, `opts?`): [`ProvisionError`](#provisionerror)

###### Parameters

###### code

[`ErrorCode`](#errorcode-1)

###### message

`string`

###### opts?

[`MachinenErrorOptions`](#machinenerroroptions) = `{}`

###### Returns

[`ProvisionError`](#provisionerror)

###### Inherited from

[`MachinenError`](#machinenerror).[`constructor`](#constructor)

#### Properties

##### code

> `readonly` **code**: [`ErrorCode`](#errorcode-1)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### RegistryError

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new RegistryError**(`code`, `message`, `opts?`): [`RegistryError`](#registryerror)

###### Parameters

###### code

[`ErrorCode`](#errorcode-1)

###### message

`string`

###### opts?

[`MachinenErrorOptions`](#machinenerroroptions) = `{}`

###### Returns

[`RegistryError`](#registryerror)

###### Inherited from

[`MachinenError`](#machinenerror).[`constructor`](#constructor)

#### Properties

##### code

> `readonly` **code**: [`ErrorCode`](#errorcode-1)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### FilesError

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new FilesError**(`code`, `message`, `opts?`): [`FilesError`](#fileserror)

###### Parameters

###### code

[`ErrorCode`](#errorcode-1)

###### message

`string`

###### opts?

[`MachinenErrorOptions`](#machinenerroroptions) = `{}`

###### Returns

[`FilesError`](#fileserror)

###### Inherited from

[`MachinenError`](#machinenerror).[`constructor`](#constructor)

#### Properties

##### code

> `readonly` **code**: [`ErrorCode`](#errorcode-1)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### MountError

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new MountError**(`code`, `message`, `opts?`): [`MountError`](#mounterror)

###### Parameters

###### code

[`ErrorCode`](#errorcode-1)

###### message

`string`

###### opts?

[`MachinenErrorOptions`](#machinenerroroptions) = `{}`

###### Returns

[`MountError`](#mounterror)

###### Inherited from

[`MachinenError`](#machinenerror).[`constructor`](#constructor)

#### Properties

##### code

> `readonly` **code**: [`ErrorCode`](#errorcode-1)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### SecretsError

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new SecretsError**(`code`, `message`, `opts?`): [`SecretsError`](#secretserror)

###### Parameters

###### code

[`ErrorCode`](#errorcode-1)

###### message

`string`

###### opts?

[`MachinenErrorOptions`](#machinenerroroptions) = `{}`

###### Returns

[`SecretsError`](#secretserror)

###### Inherited from

[`MachinenError`](#machinenerror).[`constructor`](#constructor)

#### Properties

##### code

> `readonly` **code**: [`ErrorCode`](#errorcode-1)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### WinsizeError

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new WinsizeError**(`code`, `message`, `opts?`): [`WinsizeError`](#winsizeerror)

###### Parameters

###### code

[`ErrorCode`](#errorcode-1)

###### message

`string`

###### opts?

[`MachinenErrorOptions`](#machinenerroroptions) = `{}`

###### Returns

[`WinsizeError`](#winsizeerror)

###### Inherited from

[`MachinenError`](#machinenerror).[`constructor`](#constructor)

#### Properties

##### code

> `readonly` **code**: [`ErrorCode`](#errorcode-1)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### SandboxError

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new SandboxError**(`code`, `message`, `opts?`): [`SandboxError`](#sandboxerror)

###### Parameters

###### code

[`ErrorCode`](#errorcode-1)

###### message

`string`

###### opts?

[`MachinenErrorOptions`](#machinenerroroptions) = `{}`

###### Returns

[`SandboxError`](#sandboxerror)

###### Inherited from

[`MachinenError`](#machinenerror).[`constructor`](#constructor)

#### Properties

##### code

> `readonly` **code**: [`ErrorCode`](#errorcode-1)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### CacheError

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new CacheError**(`code`, `message`, `opts?`): [`CacheError`](#cacheerror)

###### Parameters

###### code

[`ErrorCode`](#errorcode-1)

###### message

`string`

###### opts?

[`MachinenErrorOptions`](#machinenerroroptions) = `{}`

###### Returns

[`CacheError`](#cacheerror)

###### Inherited from

[`MachinenError`](#machinenerror).[`constructor`](#constructor)

#### Properties

##### code

> `readonly` **code**: [`ErrorCode`](#errorcode-1)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### GvproxyError

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new GvproxyError**(`code`, `message`, `opts?`): [`GvproxyError`](#gvproxyerror)

###### Parameters

###### code

[`ErrorCode`](#errorcode-1)

###### message

`string`

###### opts?

[`MachinenErrorOptions`](#machinenerroroptions) = `{}`

###### Returns

[`GvproxyError`](#gvproxyerror)

###### Inherited from

[`MachinenError`](#machinenerror).[`constructor`](#constructor)

#### Properties

##### code

> `readonly` **code**: [`ErrorCode`](#errorcode-1)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### MkinitramfsError

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new MkinitramfsError**(`code`, `message`, `opts?`): [`MkinitramfsError`](#mkinitramfserror)

###### Parameters

###### code

[`ErrorCode`](#errorcode-1)

###### message

`string`

###### opts?

[`MachinenErrorOptions`](#machinenerroroptions) = `{}`

###### Returns

[`MkinitramfsError`](#mkinitramfserror)

###### Inherited from

[`MachinenError`](#machinenerror).[`constructor`](#constructor)

#### Properties

##### code

> `readonly` **code**: [`ErrorCode`](#errorcode-1)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### ParseError

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new ParseError**(`code`, `message`, `opts?`): [`ParseError`](#parseerror)

###### Parameters

###### code

[`ErrorCode`](#errorcode-1)

###### message

`string`

###### opts?

[`MachinenErrorOptions`](#machinenerroroptions) = `{}`

###### Returns

[`ParseError`](#parseerror)

###### Inherited from

[`MachinenError`](#machinenerror).[`constructor`](#constructor)

#### Properties

##### code

> `readonly` **code**: [`ErrorCode`](#errorcode-1)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### Sandboxes

Registry of live sandboxes. Thread-safe in the sense that there's
only one runtime thread anyway; the class just bookkeeps handles +
their scrollback rings so the supervisor doesn't need to.

#### Constructors

##### Constructor

> **new Sandboxes**(`opts?`): [`Sandboxes`](#sandboxes)

###### Parameters

###### opts?

###### scrollbackBytes?

`number`

###### Returns

[`Sandboxes`](#sandboxes)

#### Properties

##### scrollbackBytes

> `readonly` **scrollbackBytes**: `number`

Maximum bytes retained per sandbox for replay on attach. The ring
keeps only the most recent chunk up to this limit — a reasonable
trade between "see enough context to know what's going on" and
"don't leak memory if the sandbox runs for hours."

#### Methods

##### add()

> **add**(`id`, `vm`): `void`

###### Parameters

###### id

`string`

###### vm

[`VmHandle`](#vmhandle)

###### Returns

`void`

##### remove()

> **remove**(`id`): `void`

Remove a sandbox. Does not kill the VM — call `vm.kill()` first.

###### Parameters

###### id

`string`

###### Returns

`void`

##### list()

> **list**(): `object`[]

###### Returns

`object`[]

##### get()

> **get**(`id`): [`SandboxEntry`](#sandboxentry)

###### Parameters

###### id

`string`

###### Returns

[`SandboxEntry`](#sandboxentry)

##### send()

> **send**(`id`, `data`): `boolean`

Write `data` to the sandbox's stdin. No-op if the id is unknown.

###### Parameters

###### id

`string`

###### data

`string` \| `Buffer`\<`ArrayBufferLike`\>

###### Returns

`boolean`

##### onOutput()

> **onOutput**(`id`, `fn`): () => `void`

Subscribe to `id`'s output. Returns an unsubscribe function. The
listener fires only for NEW bytes produced after the subscription
— use `get(id).scrollback` to replay history if you want it.

###### Parameters

###### id

`string`

###### fn

[`OnOutputListener`](#onoutputlistener)

###### Returns

() => `void`

***

### Supervisor

A minimal text-driven multiplexer. Runs until `.stop()` is called
or the input stream ends.

Command surface when detached (lines prefixed with `/`):
  /ls              — list sandboxes and their state
  /attach <id>     — forward to/from the given sandbox
  /help            — show commands
  /quit            — stop the supervisor (does not kill sandboxes)

When attached, bytes are piped verbatim to the sandbox's stdin.
Hit `Ctrl-] Ctrl-]` (two 0x1D bytes in a row) to detach.

#### Constructors

##### Constructor

> **new Supervisor**(`opts`): [`Supervisor`](#supervisor)

###### Parameters

###### opts

[`SupervisorOptions`](#supervisoroptions)

###### Returns

[`Supervisor`](#supervisor)

#### Properties

##### sandboxes

> `readonly` **sandboxes**: [`Sandboxes`](#sandboxes)

#### Methods

##### run()

> **run**(): `Promise`\<`void`\>

Run until stopped. Resolves when input ends or stop() is called.

###### Returns

`Promise`\<`void`\>

##### stop()

> **stop**(): `void`

Programmatic stop (e.g. from a test).

###### Returns

`void`

##### attach()

> **attach**(`id`): `void`

Attach to `id`. Throws if id doesn't exist.

###### Parameters

###### id

`string`

###### Returns

`void`

##### detach()

> **detach**(): `void`

###### Returns

`void`

***

### NodeRuntimeAdapterUnsupportedError

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new NodeRuntimeAdapterUnsupportedError**(`refusals`): [`NodeRuntimeAdapterUnsupportedError`](#noderuntimeadapterunsupportederror)

###### Parameters

###### refusals

[`RuntimeAdapterRefusal`](#runtimeadapterrefusal)[]

###### Returns

[`NodeRuntimeAdapterUnsupportedError`](#noderuntimeadapterunsupportederror)

###### Overrides

`Error.constructor`

#### Properties

##### refusals

> `readonly` **refusals**: [`RuntimeAdapterRefusal`](#runtimeadapterrefusal)[]

***

### RuntimeAdapterValidationError

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new RuntimeAdapterValidationError**(`errors`): [`RuntimeAdapterValidationError`](#runtimeadaptervalidationerror)

###### Parameters

###### errors

`string`[]

###### Returns

[`RuntimeAdapterValidationError`](#runtimeadaptervalidationerror)

###### Overrides

`Error.constructor`

#### Properties

##### errors

> `readonly` **errors**: `string`[]

***

### VsockWinsize

#### Methods

##### connect()

> `static` **connect**(`udsPath`, `opts?`): `Promise`\<[`VsockWinsize`](#vsockwinsize)\>

Open a host Unix socket and keep retrying until the vsock bridge
+ guest agent wire themselves up. Resolves once the TCP-like
connect completes — the agent may still be registering the
vsock listener on its side, but any bytes we send will be
buffered by the bridge's connection table.

###### Parameters

###### udsPath

`string`

###### opts?

[`VsockWinsizeOptions`](#vsockwinsizeoptions) = `{}`

###### Returns

`Promise`\<[`VsockWinsize`](#vsockwinsize)\>

##### send()

> **send**(`cols`, `rows`): `void`

Send a new size. Idempotent against the most recent send — repeats
are dropped so a chatty SIGWINCH doesn't spam the bridge.

###### Parameters

###### cols

`number`

###### rows

`number`

###### Returns

`void`

##### close()

> **close**(): `void`

###### Returns

`void`

## Interfaces

### BalloonCounters

#### Properties

##### bytesReported

> **bytesReported**: `number`

Total bytes the balloon device has reclaimed via reporting.

##### bytesInflated

> **bytesInflated**: `number`

Total bytes the inflate queue has seen. We don't drive inflate
(`num_pages` stays 0), so this stays at 0 in well-behaved
deployments — non-zero means a buggy/hostile guest is pushing
pages into the balloon on its own.

##### hostPhysFootprintBytes

> **hostPhysFootprintBytes**: `number`

Latest sample of this VMM's Darwin `phys_footprint` (the metric
that backs Activity Monitor's "Memory" column and excludes
`MADV_FREE_REUSABLE` pages). Refreshed every ~500 ms by a
sampler thread inside the VMM. Always 0 on Linux — there's no
Darwin-equivalent metric and the runtime reads
`/proc/<pid>/status:VmRSS` instead, which already reflects
`MADV_DONTNEED` reclaim.

***

### ProbeBunRuntimeAdapterOptions

#### Properties

##### bunCommand?

> `optional` **bunCommand?**: `string`

##### packagedExecutablePath?

> `optional` **packagedExecutablePath?**: `string`

***

### BunPackagedExecutableIdentity

#### Properties

##### path

> **path**: `string`

##### sha256

> **sha256**: `string`

***

### MachinenErrorOptions

#### Properties

##### retryable?

> `optional` **retryable?**: `boolean`

True if retrying the same call could plausibly succeed (transient
network blip, upstream fetch, vsock agent not listening yet). False
for misconfiguration (missing binary, bad mount path, invalid
port).

##### cause?

> `optional` **cause?**: `unknown`

Underlying error preserved via the standard `Error.cause` chain.

***

### VsockExecOptions

#### Properties

##### connectTimeoutMs?

> `optional` **connectTimeoutMs?**: `number`

How long to keep retrying the UDS connect. Default 30s.

##### retryMs?

> `optional` **retryMs?**: `number`

Poll interval in ms while retrying. Default 250.

##### execTimeoutMs?

> `optional` **execTimeoutMs?**: `number`

Wall-clock ceiling for the spawned command. Default 5 minutes.
Pass `null` (or `Infinity`) to disable — appropriate for
long-running siblings (dev servers, file watchers, log tailers)
that should live for the VM's lifetime. Mirrors `boot({ timeoutMs: null })`.

##### onStdout?

> `optional` **onStdout?**: (`chunk`) => `void`

Called with each stdout chunk as it arrives (pass-through tee).

###### Parameters

###### chunk

`Buffer`

###### Returns

`void`

##### onStderr?

> `optional` **onStderr?**: (`chunk`) => `void`

Called with each stderr chunk as it arrives (pass-through tee).

###### Parameters

###### chunk

`Buffer`

###### Returns

`void`

***

### VsockExecResult

#### Properties

##### exitCode

> **exitCode**: `number`

##### stdout

> **stdout**: `string`

Concatenated stdout bytes, decoded as UTF-8. Always `""` when the
caller passed `onStdout` — streaming callers already have the
bytes and a parallel buffered copy would defeat the streaming
(and at multi-GB volumes would crash with ERR_STRING_TOO_LONG).

##### stderr

> **stderr**: `string`

Same shape as `stdout` for the stderr channel + `onStderr`.

***

### VsockExecPtyOptions

#### Properties

##### cols

> **cols**: `number`

Initial window size; the guest passes this to forkpty()'s winp.

##### rows

> **rows**: `number`

##### stdin

> **stdin**: `Readable`

Host-side input source. Each `data` chunk is forwarded as an
`I <n>\n<bytes>` frame. Caller wires `process.stdin` (in raw
mode) here for an interactive shell.

##### stdout

> **stdout**: `Writable`

Host-side sink for PTY master output (`O <n>\n<bytes>` frames).
Caller wires `process.stdout`.

##### connectTimeoutMs?

> `optional` **connectTimeoutMs?**: `number`

Connect timeout (ms). Default 5000 — agent should already be up.

***

### VsockExecPtyResult

#### Properties

##### exitCode

> **exitCode**: `number`

***

### VsockExecPtyHandle

#### Properties

##### result

> `readonly` **result**: `Promise`\<[`VsockExecPtyResult`](#vsockexecptyresult)\>

Resolves with the workload's exit code once X arrives.

#### Methods

##### resize()

> **resize**(`cols`, `rows`): `void`

Send a TIOCSWINSZ update. Hook from host's SIGWINCH.

###### Parameters

###### cols

`number`

###### rows

`number`

###### Returns

`void`

##### cancel()

> **cancel**(): `void`

Disconnect; agent will SIGHUP the workload.

###### Returns

`void`

***

### VsockFilesOptions

#### Properties

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

How long to retry the UDS connect. Default 5s.

##### retryMs?

> `optional` **retryMs?**: `number`

##### excludes?

> `optional` **excludes?**: `string`[]

Forwarded to `tar --exclude=PATTERN`. Repeat per pattern.

***

### GcResult

Per-entry record of what `runGc` did (or would do, with dryRun).

#### Properties

##### pid

> **pid**: `number`

##### name?

> `optional` **name?**: `string`

##### status

> **status**: [`PidStatus`](#pidstatus)

##### removedPaths

> **removedPaths**: `string`[]

Paths removed (or that would be removed under `dryRun`).

##### failedPaths

> **failedPaths**: `string`[]

Paths the gc tried to rm but couldn't (already gone, EPERM, …).

##### registryRemoved

> **registryRemoved**: `boolean`

True if the registry entry was (or would be) dropped.

***

### RunGcOptions

#### Properties

##### dryRun?

> `optional` **dryRun?**: `boolean`

When true, list what would be cleaned without touching the disk
or registry. Used by `machinen gc --dry-run` and tests.

##### pid?

> `optional` **pid?**: `number`

Only act on this single entry (skip everything else in the
registry). Used by `machinen stop` after killing a specific VM.

***

### CheckForkBackpressureOptions

#### Properties

##### threshold

> **threshold**: `number`

Fraction of host total memory that must remain free for a fork
to proceed. Pass `0` (or any non-positive number) to disable the
gate entirely. Capped at `1` — `0.5` already means "refuse
unless half the host is free."

##### readFree?

> `optional` **readFree?**: () => `Promise`\<`number`\>

Pluggable for tests; defaults to [readHostFreeBytes](#readhostfreebytes).

###### Returns

`Promise`\<`number`\>

##### totalBytes?

> `optional` **totalBytes?**: `number`

Pluggable for tests; defaults to [readHostTotalBytes](#readhosttotalbytes).

***

### CaptureJsBuildIdentityOptions

#### Properties

##### rootDir

> **rootDir**: `string`

##### entrypoints

> **entrypoints**: `string`[]

##### packageJsonPath?

> `optional` **packageJsonPath?**: `string`

##### lockfilePath?

> `optional` **lockfilePath?**: `string`

##### artifactPaths?

> `optional` **artifactPaths?**: `string`[]

***

### JsBuildIdentityFile

#### Properties

##### path

> **path**: `string`

##### sha256

> **sha256**: `string`

***

### JsBuildIdentitySidecar

#### Properties

##### formatVersion

> **formatVersion**: `1`

##### kind

> **kind**: `"machinen-js-build-identity"`

##### rootDir

> **rootDir**: `string`

##### entrypoints

> **entrypoints**: `string`[]

##### files

> **files**: [`JsBuildIdentityFile`](#jsbuildidentityfile)[]

##### build

> **build**: [`RuntimeAdapterBuild`](#runtimeadapterbuild)

***

### ChunkLogEvent

#### Properties

##### source

> **source**: `"guest-console"` \| `"exec-stdout"` \| `"exec-stderr"`

Where the chunk came from:
  - `guest-console` — kernel / PL011 console bytes (VMM stderr)
  - `exec-stdout`   — stdout of an exec invocation
  - `exec-stderr`   — stderr of an exec invocation

##### cmd?

> `optional` **cmd?**: `string`

Command string; set when `source` is `exec-stdout` or `exec-stderr`.

##### chunk

> **chunk**: `Buffer`

Raw bytes as they arrive — not line-split, not decoded.

***

### PhaseLogEvent

#### Properties

##### source

> **source**: `"phase"`

##### kind

> **kind**: `"restore"` \| `"boot"` \| `"provision"` \| `"snapshot"`

Which runtime entry point produced these phases.

##### phases

> **phases**: `ReadonlyMap`\<`string`, `number`\>

Phase name → wall-clock ms. Insertion order = timeline order.

##### totalMs

> **totalMs**: `number`

Wall-clock between PhaseTimer construction and flush.

***

### PackBundleOptions

#### Properties

##### bundle

> **bundle**: `string`

Bundle directory with rootfs/ + machinen-config.json.

##### out

> **out**: `string`

Path to the initramfs cpio to write.

##### base?

> `optional` **base?**: `string`

Optional arch-specific base rootfs tarball
(`rootfs-debian-arm64.tar.gz` or `rootfs-debian-amd64.tar.gz`).

##### mount?

> `optional` **mount?**: `object`

A single host directory copied into the guest between the base
tarball and the bundle's rootfs. Bundle files win on path
collisions. The caller is responsible for validating host exists
and is a directory, and that guest lives under `/mnt/`. See #64.

###### host

> **host**: `string`

###### guest

> **guest**: `string`

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Extra env vars to merge into the bundle's machinen-config.json `env`
field before packing. The bundle's on-disk env wins on key collision
(same precedence as the mount overlay — bundle always gets the last
word). See #89.

##### excludes?

> `optional` **excludes?**: `string`[]

fnmatch patterns matched against each rootfs-relative path.

##### initPath?

> `optional` **initPath?**: `string`

Optional path to the compiled /init. Default: ../microvm/test-fixtures/init relative to this file.

##### execAgentPath?

> `optional` **execAgentPath?**: `string`

Optional path to the compiled /exec-agent. Default: same dir as
/init under packages/microvm/test-fixtures/. Used to override the
stale /exec-agent that may live in a re-provisioned base tarball.

***

### PackTinyBundleOptions

#### Properties

##### bundle

> **bundle**: `string`

Bundle directory with machinen-config.json. The bundle's rootfs/ is ignored — the on-disk rootfs is on /dev/vda.

##### out

> **out**: `string`

Path to the initramfs cpio to write.

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Extra env merged into the bundle's machinen-config.json. Bundle keys win on collision.

##### mountGuest?

> `optional` **mountGuest?**: `string`

Guest mountpoint for the `--mount` overlay (#272). When set, the
cpio carries `/etc/machinen-mountdisk-guest` with this path so
/init knows where to layer the squashfs+ext4 overlay after the
rootdisk pivot. The actual payload rides on virtio-blk slots 5+6,
not in the cpio. Must be an absolute path under `/mnt/`.

##### initPath?

> `optional` **initPath?**: `string`

Optional override for the compiled /init. Default: ../microvm/test-fixtures/init relative to this file.

***

### PackRootfsOptions

#### Properties

##### rootfs

> **rootfs**: `string`

##### out

> **out**: `string`

##### config?

> `optional` **config?**: `string`

##### excludes?

> `optional` **excludes?**: `string`[]

##### initPath?

> `optional` **initPath?**: `string`

***

### PackMinimalOptions

#### Properties

##### out

> **out**: `string`

##### initPath?

> `optional` **initPath?**: `string`

##### config?

> `optional` **config?**: `string`

***

### PackWorkspaceOptions

#### Properties

##### workspace

> **workspace**: `string`

##### out

> **out**: `string`

##### mountpoint?

> `optional` **mountpoint?**: `string`

Directory name inside the cpio (default `workspace`).

##### excludes?

> `optional` **excludes?**: `Iterable`\<`string`\>

Basename-matched excludes. Default: DEFAULT_WORKSPACE_EXCLUDES.

##### maxMb?

> `optional` **maxMb?**: `number`

Max final size in MiB (default 500). Throws if exceeded.

***

### EnsureMountDiskImageOptions

#### Properties

##### cacheDir?

> `optional` **cacheDir?**: `string`

Override the cache directory. Default: `~/.cache/machinen/mountdisk`.

##### force?

> `optional` **force?**: `boolean`

Force re-materialization. Mostly for debugging the materializer.

##### onPhase?

> `optional` **onPhase?**: (`name`, `ms`) => `void`

Sub-phase callback for the caller's PhaseTimer. Fires for each
measurable internal step: `manifest-hash`, `mksquashfs`,
`staging-rename`. The caller usually does
`phases.mark("<parent>.${name}", ms)`.

###### Parameters

###### name

`string`

###### ms

`number`

###### Returns

`void`

***

### EnsureMountDiskImageResult

#### Properties

##### lowerPath

> **lowerPath**: `string`

Absolute path to the cached squashfs lower.

##### key

> **key**: `string`

Tree-manifest sha256 — also the cache key. Useful for tests.

***

### EnsureMountDiskUpperOptions

#### Properties

##### sizeBytes?

> `optional` **sizeBytes?**: `number`

Target size in bytes. Default 4 GiB. Sparse, so unused capacity
costs nothing on the host disk. Mirrors `rootDiskSizeBytes` —
over-provision to give the guest room to write without
having to grow the file mid-VM.

***

### EnsureMountDiskUpperResult

#### Properties

##### upperPath

> **upperPath**: `string`

Absolute path to the per-VM ext4 upper image.

##### sizeBytes

> **sizeBytes**: `number`

Size in bytes the file was allocated at.

***

### SandboxEntry

#### Properties

##### id

> **id**: `string`

##### vm

> **vm**: [`VmHandle`](#vmhandle)

##### scrollback

> **scrollback**: `Buffer`

##### addedAt

> `readonly` **addedAt**: `number`

***

### OnOutputListener()

> **OnOutputListener**(`chunk`, `source`): `void`

#### Parameters

##### chunk

`Buffer`

##### source

`"stdout"` \| `"stderr"`

#### Returns

`void`

***

### SupervisorOptions

#### Properties

##### sandboxes

> **sandboxes**: [`Sandboxes`](#sandboxes)

Registry to draw sandboxes from.

##### input?

> `optional` **input?**: `ReadableStream`

Input byte stream. Defaults to `process.stdin`.

##### output?

> `optional` **output?**: `Writable`

Output byte stream. Defaults to `process.stdout`.

##### commandPrefix?

> `optional` **commandPrefix?**: `string`

Prefix for slash-commands. Default `/`.

##### rawTtyOnAttach?

> `optional` **rawTtyOnAttach?**: `boolean`

Flip the terminal into raw mode while a sandbox is attached, and
restore it on detach. Enabled by default when `input` is a TTY.
Set to `false` in tests where `input` is a plain PassThrough.

##### forwardResize?

> `optional` **forwardResize?**: `boolean`

Forward SIGWINCH on the parent process (terminal resize) to any
attached sandbox that implements `.resize(cols, rows)`. Enabled
by default when `output` is a TTY.

***

### NodeAsyncContinuationInput

#### Properties

##### id

> **id**: `string`

##### kind

> **kind**: [`NodeAsyncContinuationKind`](#nodeasynccontinuationkind)

##### handlerToken

> **handlerToken**: `string`

##### payload?

> `optional` **payload?**: `unknown`

##### delayMs?

> `optional` **delayMs?**: `number`

##### reason?

> `optional` **reason?**: `string`

***

### NodeAsyncContinuationRecord

#### Properties

##### id

> **id**: `string`

##### kind

> **kind**: `"timer"` \| `"promise"`

##### state

> **state**: `"captured"`

##### handlerToken

> **handlerToken**: `string`

##### payloadRoot

> **payloadRoot**: `string`

##### delayMs

> **delayMs**: `number`

***

### NodeAsyncContinuationState

#### Properties

##### formatVersion

> **formatVersion**: `1`

##### runtime

> **runtime**: `object`

###### name

> **name**: `"node"`

###### version

> **version**: `string`

##### strategy

> **strategy**: `"semantic-continuation"`

##### adapterDocument

> **adapterDocument**: [`RuntimeAdapterDocument`](#runtimeadapterdocument)

##### continuations

> **continuations**: [`NodeAsyncContinuationRecord`](#nodeasynccontinuationrecord)[]

##### unsupported

> **unsupported**: `object`

###### vocabularyVersion

> **vocabularyVersion**: `1`

###### refusals

> **refusals**: [`RuntimeAdapterRefusal`](#runtimeadapterrefusal)[]

***

### RestoredNodeAsyncContinuation

#### Properties

##### id

> **id**: `string`

##### kind

> **kind**: `"timer"` \| `"promise"`

##### result

> **result**: `unknown`

***

### NodeRuntimeFileResource

#### Properties

##### id

> **id**: `string`

##### path

> **path**: `string`

##### flags

> **flags**: `string`[]

##### offset?

> `optional` **offset?**: `number`

***

### NodeRuntimeNativeHandleRefusal

#### Properties

##### id

> **id**: `string`

##### kind

> **kind**: [`RuntimeAdapterResourceKind`](#runtimeadapterresourcekind)

##### code?

> `optional` **code?**: `"architecture-pair-unsupported"` \| `"architecture-unsupported"` \| `"fd-kind-unsupported"` \| `"feature-unsupported"` \| `"object-unsupported"` \| `"resource-unsupported"` \| `"runtime-adapter-missing"` \| `"runtime-heap-unsupported"` \| `"target-build-mismatch"`

##### message

> **message**: `string`

##### detail?

> `optional` **detail?**: `Record`\<`string`, `unknown`\>

***

### CaptureNodeNativeResourcesOptions

#### Properties

##### argv?

> `optional` **argv?**: `string`[]

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

##### cwd?

> `optional` **cwd?**: `string`

##### files?

> `optional` **files?**: [`NodeRuntimeFileResource`](#noderuntimefileresource)[]

##### includeStdioRefusals?

> `optional` **includeStdioRefusals?**: `boolean`

##### nativeHandleRefusals?

> `optional` **nativeHandleRefusals?**: [`NodeRuntimeNativeHandleRefusal`](#noderuntimenativehandlerefusal)[]

##### extraResources?

> `optional` **extraResources?**: [`RuntimeAdapterResource`](#runtimeadapterresource)[]

***

### RestoredNodeResourceRecipes

#### Properties

##### argv?

> `optional` **argv?**: `string`[]

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

##### cwd?

> `optional` **cwd?**: `string`

##### files

> **files**: [`NodeRuntimeFileResource`](#noderuntimefileresource)[]

***

### CaptureNodeRuntimeAdapterOptions

#### Properties

##### adapterId?

> `optional` **adapterId?**: `string`

##### adapterVersion?

> `optional` **adapterVersion?**: `string`

##### target?

> `optional` **target?**: `Partial`\<[`RuntimeAdapterTarget`](#runtimeadaptertarget)\>

##### build?

> `optional` **build?**: `Partial`\<[`RuntimeAdapterBuild`](#runtimeadapterbuild)\>

##### process?

> `optional` **process?**: `object`

###### argv?

> `optional` **argv?**: `string`[]

###### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

###### cwd?

> `optional` **cwd?**: `string`

##### resources?

> `optional` **resources?**: [`RuntimeAdapterResource`](#runtimeadapterresource)[]

##### files?

> `optional` **files?**: [`NodeRuntimeFileResource`](#noderuntimefileresource)[]

##### includeStdioRefusals?

> `optional` **includeStdioRefusals?**: `boolean`

##### nativeHandleRefusals?

> `optional` **nativeHandleRefusals?**: [`NodeRuntimeNativeHandleRefusal`](#noderuntimenativehandlerefusal)[]

***

### RssTarget

A pid plus the absolute path to its stats file (when available).

#### Properties

##### pid

> **pid**: `number`

##### statsPath?

> `optional` **statsPath?**: `string`

MACHINEN_STATS_FILE path for this VMM (registry entry's
`statsPath`). On Darwin we read `phys_footprint` from this file
in preference to `ps -o rss=`. Optional / undefined for arbitrary
pids that aren't machinen-managed; those fall back to ps.

***

### ProvisionOptions

#### Properties

##### base?

> `optional` **base?**: `string`

Path to the base rootfs tarball to start from. Typically the
arch-specific rootfs tarball produced by `scripts/build-base-assets.sh`
(`rootfs-debian-arm64.tar.gz` or `rootfs-debian-amd64.tar.gz`) or
shipped in a machinen release.

Optional — when omitted, `provision()` resolves it via `resolveBaseRootfs()`
(MACHINEN_ASSETS_DIR env override, falling back to the `@machinen/cli`
cache for the selected guest arch).

##### install

> **install**: (`vm`) => `Promise`\<`void`\>

User-supplied provisioning steps. Runs inside the guest via vsock.

###### Parameters

###### vm

[`VmHandle`](#vmhandle)

###### Returns

`Promise`\<`void`\>

##### out

> **out**: `string`

Output path for the resulting rootfs tarball. Will be overwritten.
Consumed via `boot({ image: out })`.

##### cmd?

> `optional` **cmd?**: `string`[]

Default cmd baked into the image as `/machinen-config.json`.
When the image is later booted via `boot({ image })` without a
user-supplied `cmd`, the guest runs this. User-supplied `cmd` on
`boot()` still wins if provided.

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Default guest env baked into the image alongside `cmd`. Merged
with `boot({ env })` at boot time, with the caller's `env`
overriding on key collision.

##### binary?

> `optional` **binary?**: `string`

Optional VMM binary path. Same lookup rules as `boot()` — if
omitted, resolves `@machinen/native-<arch>-<os>`.

##### cwd?

> `optional` **cwd?**: `string`

Working directory. Defaults to process.cwd().

##### scratchDiskSizeBytes?

> `optional` **scratchDiskSizeBytes?**: `number`

Size of the scratch disk used to ferry the tarball from guest to
host. Must be larger than the expected post-install rootfs size.
Default: 1 GiB (sparse, so it doesn't actually take that space).

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Wall-clock ceiling for the whole build. If the install hook plus
the final archive + shutdown doesn't finish in this window, we
SIGKILL the VMM and fail. Default: 10 minutes.

##### vmmEnv?

> `optional` **vmmEnv?**: `Record`\<`string`, `string`\>

Extra env passed to the VMM process on the host side. Useful for
dev overrides like `MACHINEN_BOOT_TEST`. Distinct from `env`,
which bakes guest-workload env into the produced image.

##### kernel?

> `optional` **kernel?**: `string`

Path to the guest kernel. Optional — when omitted, `provision()`
resolves it via `resolveBaseKernel()` (MACHINEN_ASSETS_DIR override,
falling back to the `@machinen/cli` cache). Same semantics as
`boot({ kernel })` once resolved.

##### dtb?

> `optional` **dtb?**: `string`

Path to the guest DTB. Optional — when omitted, resolved via
`resolveBaseDtb()` from the same fallback chain as `kernel`.

##### onLog?

> `optional` **onLog?**: [`OnLog`](#onlog)

Streaming log callback — fires for every byte of guest output
during the build: guest kernel console, every `vm.exec()` call
the install hook makes, and the internal tar / poweroff execs.
See `LogEvent.source` to tell them apart. See #83.

***

### ProvisionResult

#### Properties

##### imagePath

> **imagePath**: `string`

Absolute path to the output tarball.

##### sizeBytes

> **sizeBytes**: `number`

Size of the output tarball in bytes.

##### elapsedMs

> **elapsedMs**: `number`

Wall-clock time from build() entry to return.

***

### PtyBootOptions

#### Properties

##### binary

> **binary**: `string`

Absolute or cwd-relative path to the binary to fork.

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Extra env. Merged over process.env.

##### cwd?

> `optional` **cwd?**: `string`

##### args?

> `optional` **args?**: `string`[]

##### cols?

> `optional` **cols?**: `number`

Initial terminal size. Defaults to 80x24.

##### rows?

> `optional` **rows?**: `number`

##### name?

> `optional` **name?**: `string`

TERM value. Default `xterm-256color` — the CC banner wants colors.

***

### PtyVmHandle

#### Properties

##### pid

> `readonly` **pid**: `number`

##### stdin

> `readonly` **stdin**: `Writable`

##### stdout

> `readonly` **stdout**: `Readable`

##### stderr

> `readonly` **stderr**: `Readable`

Same stream as `stdout`. A pty merges stdout + stderr in the kernel.

#### Methods

##### resize()

> **resize**(`cols`, `rows`): `void`

Tell the kernel the terminal is now `cols`x`rows`. Triggers SIGWINCH in the child.

###### Parameters

###### cols

`number`

###### rows

`number`

###### Returns

`void`

##### wait()

> **wait**(): `Promise`\<\{ `code`: `number`; `signal`: `Signals`; \}\>

###### Returns

`Promise`\<\{ `code`: `number`; `signal`: `Signals`; \}\>

##### kill()

> **kill**(): `Promise`\<`void`\>

###### Returns

`Promise`\<`void`\>

##### output()

> **output**(): `Promise`\<`string`\>

###### Returns

`Promise`\<`string`\>

##### errorOutput()

> **errorOutput**(): `Promise`\<`string`\>

Alias of output() — a pty gives us one merged stream.

###### Returns

`Promise`\<`string`\>

***

### RegistryEntry

#### Properties

##### pid

> **pid**: `number`

PID of the VMM process on this host — primary key.

##### name?

> `optional` **name?**: `string`

Optional human-friendly name (from `boot({ name })`). Path-shaped allowed.

##### socketPath

> **socketPath**: `string`

Host-side vsock UDS the exec-agent is reachable on.

##### imagePath?

> `optional` **imagePath?**: `string`

Path to the image the VM was booted from (diagnostic only).

##### rootDiskPath?

> `optional` **rootDiskPath?**: `string`

Host-side path of the root block device currently attached as
`/dev/vda`. Vmstate snapshots need the exact bytes because the
whole-VM state captures RAM/device/vCPU state, not disk blocks.

##### rootDiskMode?

> `optional` **rootDiskMode?**: `"block"` \| `"none"`

Whether the VM intentionally booted without a root block device.

##### diskPath?

> `optional` **diskPath?**: `string`

Host-side path of the scratch disk attached to the guest. Used by
`attach().snapshot()` so an attach-owned handle can find the
guest-side scratch disk that backs the in-VM dump.

##### vmstatePath?

> `optional` **vmstatePath?**: `string`

Vmstate engine only: absolute path the VMM writes its `.vmstate`
whole-VM state file to (the `MACHINEN_SNAPSHOT_PATH` it booted
with). Persisted so an attach-owned `vm.snapshot()` / `vm.fork()`
can SIGUSR1 the VMM and pick the state file up. Undefined for VMs
booted without the vmstate engine.

##### vmstateChainId?

> `optional` **vmstateChainId?**: `string`

Per-VM incremental checkpoint chain id. New on every fresh boot/restore.

##### vmstateCheckpointParent?

> `optional` **vmstateCheckpointParent?**: `string`

Absolute bundle path the next vmstate checkpoint should parent to.

##### vmstateCheckpointSequence?

> `optional` **vmstateCheckpointSequence?**: `number`

Per-chain checkpoint sequence already written by this VM.

##### nested?

> `optional` **nested?**: `boolean`

Whether the VM was booted with nested virtualization enabled
(`boot({ nested: true })`). Provider-level snapshots are refused
while EL2 vmstate capture/restore is still being audited.

##### forkedFrom?

> `optional` **forkedFrom?**: `string`

Absolute path to the snapshot directory this VM was forked from
(set by `restore({ snapDir })`). Visible in `ls`; informational.

##### bootLogPath?

> `optional` **bootLogPath?**: `string`

Path to the one-shot boot-console snapshot written at detach time
(issue #150 phase 2). Only set on entries booted with
`--detached`; live post-detach console bytes are dropped on the
floor (the VMM ignores SIGPIPE), so this file is the only record
of the boot sequence on a detached VM.

##### cleanupPaths?

> `optional` **cleanupPaths?**: `string`[]

Per-boot artifacts that need to be removed when the VMM exits.
Today the in-process exit hook handles this for non-detached
boots. After detach (#150 phase 2) the parent is gone before the
VMM exits — `machinen gc` / `machinen stop` use this list to
clean up afterward. Each entry is an absolute path to either a
file (per-boot disk image) or a directory (bundle / vsock UDS).

##### vmmExe?

> `optional` **vmmExe?**: `string`

Absolute path to the VMM binary that was spawned. `machinen gc`
compares this against `/proc/<pid>/exe` (Linux) or `ps -o comm=`
(macOS) before treating an entry as live — without it, a recycled
pid that happens to belong to some other process would look alive
to `kill(pid, 0)` and the entry would be kept around forever.

##### gvproxyPid?

> `optional` **gvproxyPid?**: `number`

PID of the gvproxy process spawned alongside this VMM (issue #150
phase 2 PR3). Recorded so `machinen stop` can SIGTERM gvproxy at
the same time as the VMM, and so `machinen gc` can validate /
reap it independently. Undefined when the VM was booted without
networking (no gvproxy binary, or `MACHINEN_NET_SOCKET` was
pre-set by the caller).

##### gvproxyExe?

> `optional` **gvproxyExe?**: `string`

Absolute path to the gvproxy binary spawned for this VM. Used by
`machinen stop` for the same anti-recycling check the VMM gets
via `vmmExe` — we don't want to SIGTERM whatever process inherits
gvproxy's pid weeks later.

##### portForward?

> `optional` **portForward?**: `object`[]

Host→guest port forwards configured at boot/fork time. Surfaced
in `machinen ls` so users can see which host port maps to which
VM without re-reading the launch command. Undefined when the VM
was booted without `-p` / `portForward: []`.

###### hostPort

> **hostPort**: `number`

###### guestPort

> **guestPort**: `number`

###### hostAddr?

> `optional` **hostAddr?**: `string`

##### memoryCeilingMib?

> `optional` **memoryCeilingMib?**: `number`

Guest RAM ceiling in MiB, as resolved by `boot()` (either the
caller's `memory:` option or `autoSizeMemoryMib()` for this host
— see #263 phase A). Surfaced in `machinen ls` (MEM column) and
read by `vm.memoryStats()` so callers can compare host RSS
against the ceiling without re-deriving it. Undefined when the
caller pre-set `MACHINEN_MEMORY` via `vmmEnv` and we never
computed our own.

##### statsPath?

> `optional` **statsPath?**: `string`

Absolute path to the shared stats file the VMM writes balloon
counters to (#274). 16 bytes, mmaped MAP_SHARED on the VMM side
via `MACHINEN_STATS_FILE`. Persisted so an attach-owned handle
can read the same counters its boot-owned sibling sees. Undefined
for VMMs launched outside the runtime (which never received the
env var).

##### lazyPagesTotal?

> `optional` **lazyPagesTotal?**: `number`

Total pages the lazy-pages rewriter (#266) marked PE_LAZY when
the VM was restored. Set on restore-derived entries, undefined
for plain boots and eager restores. Surfaced via
`vm.memoryStats().lazyPagesPending`.

##### mountDisk?

> `optional` **mountDisk?**: `object`

#272: when the VM was booted with `mount: { host, guest }`, the
runtime materialized a squashfs RO lower + ext4 RW upper. Persist
those host paths so an attach-owned `vm.snapshot()` /
`vm.fork()` can reflink them into the snapshot bundle exactly
like the boot-owned handle does — without this, a CLI-side
`machinen snapshot <vm>` produces a bundle missing
`mount-lower.sqfs` / `mount-upper.img` and a later `restore`
silently boots without the overlay.

###### guest

> **guest**: `string`

###### lowerPath

> **lowerPath**: `string`

###### upperPath

> **upperPath**: `string`

##### liveMounts?

> `optional` **liveMounts?**: `object`[]

#273: live-share mounts (`liveMounts: [...]` at boot) the VM was
started with. Persisted so an attach-owned `vm.snapshot()` /
`vm.fork()` can record the same `meta.liveMounts` block in the
bundle. Since #332 every live mount is served by an in-VMM
virtio-fs device — there's no host-side process to record, reap,
or reconnect to. The per-mount virtio-fs tag isn't recorded
either; it's re-derived from the resolved order on restore.

###### guest

> **guest**: `string`

###### host

> **host**: `string`

###### mode

> **mode**: `"ro"` \| `"rw"`

##### startedAt

> **startedAt**: `number`

ms epoch when the entry was created.

***

### EnsureRootfsImageOptions

#### Properties

##### cacheDir?

> `optional` **cacheDir?**: `string`

Override the cache directory. Default: `~/.cache/machinen/rootfs`.
Useful for tests.

##### force?

> `optional` **force?**: `boolean`

Force re-materialization even if a cached image is already present.
Mostly for debugging the materializer.

##### sizeMultiplier?

> `optional` **sizeMultiplier?**: `number`

Slack multiplier above the unpacked tarball size when sizing the
ext4 filesystem. Default: 2.5 — leaves enough room for the guest
to install a few hundred MB of packages on top of the base rootfs
before hitting ENOSPC. Sparse files cost nothing on disk until
written, so over-provisioning is essentially free; the trade-off
is a higher upper bound on physical disk use if the guest decides
to fill the filesystem.

##### minSizeBytes?

> `optional` **minSizeBytes?**: `number`

Minimum image size in bytes. The materializer enforces at least
this for small rootfs where the multiplier alone would leave
insufficient room for a real workload. Default: 2 GiB — boot-time
`npm install -g <large package>`, `apt install`, etc. land here
(#131). Sparse, so unused capacity is free.

##### sizeBytes?

> `optional` **sizeBytes?**: `number`

Absolute target size in bytes. When set, overrides `sizeMultiplier`
and `minSizeBytes` entirely — fresh materializations get exactly
this size, cached `.img`s smaller than this are sparse-extended
(truncate(2)) so the next boot's online ext4 grow can fill them.
For the user-facing `boot({ rootDiskSizeBytes })` knob (#131).

##### onPhase?

> `optional` **onPhase?**: (`name`, `ms`) => `void`

Sub-phase callback for the caller's PhaseTimer (#233 follow-up).
Fires for each measurable internal step: `sha256`, `e2fsck`,
`sparse-extend`, `tar-extract`, `mke2fs`, `gunzip-prebake`. The
caller typically does `phases.mark("<parent>.${name}", ms)` so
the breakdown shows up alongside the parent phase.

###### Parameters

###### name

`string`

###### ms

`number`

###### Returns

`void`

***

### RuntimeAdapterRefusal

#### Properties

##### code

> **code**: `"architecture-pair-unsupported"` \| `"architecture-unsupported"` \| `"fd-kind-unsupported"` \| `"feature-unsupported"` \| `"object-unsupported"` \| `"resource-unsupported"` \| `"runtime-adapter-missing"` \| `"runtime-heap-unsupported"` \| `"target-build-mismatch"`

##### message

> **message**: `string`

##### detail?

> `optional` **detail?**: `Record`\<`string`, `unknown`\>

***

### RuntimeAdapterUnsupportedVocabulary

#### Properties

##### vocabularyVersion

> **vocabularyVersion**: `1`

##### refusals

> **refusals**: [`RuntimeAdapterRefusal`](#runtimeadapterrefusal)[]

***

### RuntimeAdapterEntrypoint

#### Properties

##### command

> **command**: `string`

##### args

> **args**: `string`[]

##### transport

> **transport**: [`RuntimeAdapterTransport`](#runtimeadaptertransport)

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

***

### RuntimeAdapterEntrypoints

#### Properties

##### capture

> **capture**: [`RuntimeAdapterEntrypoint`](#runtimeadapterentrypoint)

##### restore

> **restore**: [`RuntimeAdapterEntrypoint`](#runtimeadapterentrypoint)

***

### RuntimeAdapterDescriptor

#### Properties

##### id

> **id**: `string`

##### protocolVersion

> **protocolVersion**: `1`

##### runtime

> **runtime**: [`RuntimeAdapterRuntimeName`](#runtimeadapterruntimename)

##### name

> **name**: `string`

##### version?

> `optional` **version?**: `string`

##### features

> **features**: `string`[]

##### entrypoints

> **entrypoints**: [`RuntimeAdapterEntrypoints`](#runtimeadapterentrypoints)

***

### RuntimeAdapterTarget

#### Properties

##### id

> **id**: `string`

##### name

> **name**: `string`

##### executable

> **executable**: `string`

##### sourceGuestArch

> **sourceGuestArch**: [`RuntimeAdapterArch`](#runtimeadapterarch)

##### allowedTargetGuestArchs

> **allowedTargetGuestArchs**: [`RuntimeAdapterArch`](#runtimeadapterarch)[]

***

### RuntimeAdapterSerializerCompatibility

#### Properties

##### semanticGraph

> **semanticGraph**: `object`

###### supported

> **supported**: `true`

###### format

> **format**: `"machinen-runtime-adapter-v1"`

##### rawHeap

> **rawHeap**: `object`

###### supported

> **supported**: `false`

###### refusal

> **refusal**: [`RuntimeAdapterRefusal`](#runtimeadapterrefusal)

##### v8Serialize?

> `optional` **v8Serialize?**: `object`

###### supported

> **supported**: `boolean`

###### versionBound

> **versionBound**: `boolean`

###### portable

> **portable**: `false`

###### api?

> `optional` **api?**: `string`

##### structuredClone?

> `optional` **structuredClone?**: `object`

###### supported

> **supported**: `boolean`

###### persistentFormat

> **persistentFormat**: `false`

##### heapSnapshot?

> `optional` **heapSnapshot?**: `object`

###### inspected

> **inspected**: `boolean`

###### restoreSupported

> **restoreSupported**: `false`

###### finding?

> `optional` **finding?**: `string`

***

### RuntimeAdapterRuntime

#### Properties

##### name

> **name**: [`RuntimeAdapterRuntimeName`](#runtimeadapterruntimename)

##### version

> **version**: `string`

##### engine?

> `optional` **engine?**: `object`

###### name

> **name**: `string`

###### version

> **version**: `string`

##### serializerCompatibility

> **serializerCompatibility**: [`RuntimeAdapterSerializerCompatibility`](#runtimeadapterserializercompatibility)

***

### RuntimeAdapterBuildModule

#### Properties

##### specifier

> **specifier**: `string`

##### kind

> **kind**: [`RuntimeAdapterModuleKind`](#runtimeadaptermodulekind)

##### sha256?

> `optional` **sha256?**: `string`

***

### RuntimeAdapterBuildIdentity

#### Properties

##### sourceSha256?

> `optional` **sourceSha256?**: `string`

##### packageSha256?

> `optional` **packageSha256?**: `string`

##### lockfileSha256?

> `optional` **lockfileSha256?**: `string`

##### moduleGraphSha256?

> `optional` **moduleGraphSha256?**: `string`

##### artifactSha256?

> `optional` **artifactSha256?**: `string`

***

### RuntimeAdapterBuild

#### Properties

##### identity

> **identity**: [`RuntimeAdapterBuildIdentity`](#runtimeadapterbuildidentity)

##### modules

> **modules**: [`RuntimeAdapterBuildModule`](#runtimeadapterbuildmodule)[]

***

### RuntimeAdapterProcess

#### Properties

##### argv

> **argv**: `string`[]

##### env

> **env**: `Record`\<`string`, `string`\>

##### cwd

> **cwd**: `string`

***

### RuntimeAdapterRoot

#### Properties

##### name

> **name**: `string`

##### value

> **value**: [`RuntimeAdapterValue`](#runtimeadaptervalue)

***

### RuntimeAdapterMapEntry

#### Properties

##### key

> **key**: [`RuntimeAdapterValue`](#runtimeadaptervalue)

##### value

> **value**: [`RuntimeAdapterValue`](#runtimeadaptervalue)

***

### RuntimeAdapterObjectNode

#### Properties

##### id

> **id**: `string`

##### kind

> **kind**: [`RuntimeAdapterObjectKind`](#runtimeadapterobjectkind)

##### type?

> `optional` **type?**: `string`

##### prototype?

> `optional` **prototype?**: `string`

##### properties?

> `optional` **properties?**: `Record`\<`string`, [`RuntimeAdapterValue`](#runtimeadaptervalue)\>

##### elements?

> `optional` **elements?**: [`RuntimeAdapterValue`](#runtimeadaptervalue)[]

##### entries?

> `optional` **entries?**: [`RuntimeAdapterMapEntry`](#runtimeadaptermapentry)[]

##### byteLength?

> `optional` **byteLength?**: `number`

##### refusal?

> `optional` **refusal?**: [`RuntimeAdapterRefusal`](#runtimeadapterrefusal)

***

### RuntimeAdapterIdentityAssertion

#### Properties

##### left

> **left**: `string`

##### right

> **right**: `string`

##### same

> **same**: `boolean`

***

### RuntimeAdapterGraph

#### Properties

##### roots

> **roots**: [`RuntimeAdapterRoot`](#runtimeadapterroot)[]

##### objects

> **objects**: [`RuntimeAdapterObjectNode`](#runtimeadapterobjectnode)[]

##### identityAssertions?

> `optional` **identityAssertions?**: [`RuntimeAdapterIdentityAssertion`](#runtimeadapteridentityassertion)[]

##### checksumHex?

> `optional` **checksumHex?**: `string`

***

### RuntimeAdapterResourceRecipe

#### Properties

##### kind

> **kind**: `string`

##### detail?

> `optional` **detail?**: `Record`\<`string`, `unknown`\>

***

### RuntimeAdapterResource

#### Properties

##### id

> **id**: `string`

##### kind

> **kind**: [`RuntimeAdapterResourceKind`](#runtimeadapterresourcekind)

##### state

> **state**: [`RuntimeAdapterResourceState`](#runtimeadapterresourcestate)

##### recipe?

> `optional` **recipe?**: [`RuntimeAdapterResourceRecipe`](#runtimeadapterresourcerecipe)

##### refusal?

> `optional` **refusal?**: [`RuntimeAdapterRefusal`](#runtimeadapterrefusal)

***

### RuntimeAdapterResources

#### Properties

##### resources

> **resources**: [`RuntimeAdapterResource`](#runtimeadapterresource)[]

##### unsupported

> **unsupported**: [`RuntimeAdapterUnsupportedVocabulary`](#runtimeadapterunsupportedvocabulary)

***

### RuntimeAdapterRestoreContract

#### Properties

##### semanticStateSupported

> **semanticStateSupported**: `boolean`

##### liveProcessSupported

> **liveProcessSupported**: `boolean`

##### requiredMetadata

> **requiredMetadata**: `string`[]

##### refusal?

> `optional` **refusal?**: [`RuntimeAdapterRefusal`](#runtimeadapterrefusal)

***

### RuntimeAdapterBundleObjectMapping

#### Properties

##### portableObjectId

> **portableObjectId**: `string`

##### role

> **role**: [`RuntimeAdapterMappingRole`](#runtimeadaptermappingrole)

##### graphObjectIds?

> `optional` **graphObjectIds?**: `string`[]

***

### RuntimeAdapterBundleResourceMapping

#### Properties

##### portableResourceId

> **portableResourceId**: `string`

##### runtimeResourceId

> **runtimeResourceId**: `string`

***

### RuntimeAdapterBundleMapping

#### Properties

##### manifestFeatures

> **manifestFeatures**: `string`[]

##### sidecarFiles

> **sidecarFiles**: `string`[]

##### objects

> **objects**: [`RuntimeAdapterBundleObjectMapping`](#runtimeadapterbundleobjectmapping)[]

##### resources

> **resources**: [`RuntimeAdapterBundleResourceMapping`](#runtimeadapterbundleresourcemapping)[]

***

### RuntimeAdapterDocument

#### Properties

##### formatVersion

> **formatVersion**: `1`

##### adapter

> **adapter**: [`RuntimeAdapterDescriptor`](#runtimeadapterdescriptor)

##### target

> **target**: [`RuntimeAdapterTarget`](#runtimeadaptertarget)

##### runtime

> **runtime**: [`RuntimeAdapterRuntime`](#runtimeadapterruntime)

##### build

> **build**: [`RuntimeAdapterBuild`](#runtimeadapterbuild)

##### process

> **process**: [`RuntimeAdapterProcess`](#runtimeadapterprocess)

##### graph

> **graph**: [`RuntimeAdapterGraph`](#runtimeadaptergraph)

##### resources

> **resources**: [`RuntimeAdapterResources`](#runtimeadapterresources)

##### restore

> **restore**: [`RuntimeAdapterRestoreContract`](#runtimeadapterrestorecontract)

##### bundleMapping

> **bundleMapping**: [`RuntimeAdapterBundleMapping`](#runtimeadapterbundlemapping)

##### unsupported

> **unsupported**: [`RuntimeAdapterUnsupportedVocabulary`](#runtimeadapterunsupportedvocabulary)

***

### VsockSecretsOptions

#### Properties

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

How long to keep retrying the UDS connect. Default 10s.

##### retryMs?

> `optional` **retryMs?**: `number`

Poll interval in ms while retrying. Default 250.

***

### VmHandle

#### Properties

##### pid

> `readonly` **pid**: `number`

PID of the host-side VMM process — primary identifier across
boot/attach. Kernel-unique while alive; reused after exit, so
pass it to `attach({ pid })` while the VM is live (or use
`--name` for a stable handle).

##### name?

> `readonly` `optional` **name?**: `string`

Optional human-friendly name passed to `boot({ name })`.

##### stdin

> `readonly` **stdin**: `Writable`

##### stdout

> `readonly` **stdout**: `Readable`

##### stderr

> `readonly` **stderr**: `Readable`

#### Methods

##### wait()

> **wait**(): `Promise`\<\{ `code`: `number`; `signal`: `Signals`; \}\>

Resolves when the VM process exits. Rejects on timeout.

###### Returns

`Promise`\<\{ `code`: `number`; `signal`: `Signals`; \}\>

##### kill()

> **kill**(): `Promise`\<`void`\>

Send SIGKILL to the VM. Resolves once it's really gone.

###### Returns

`Promise`\<`void`\>

##### detach()

> **detach**(): `Promise`\<`void`\>

Drop this host-side handle without killing the VMM. The VM keeps
running and can be re-attached from another process. For locally-
booted handles this closes captured streams; `wait()` and
`exec()` become unreliable afterwards.

###### Returns

`Promise`\<`void`\>

##### output()

> **output**(): `Promise`\<`string`\>

Buffer stdout until the process exits; return it as a UTF-8 string.
Capped at ~1 MiB tail — long-running VMs keep only the most recent
bytes (issue #150). Sufficient for kernel boot console + test
assertions; not a full transcript.

###### Returns

`Promise`\<`string`\>

##### errorOutput()

> **errorOutput**(): `Promise`\<`string`\>

Same as `output()` but for stderr (where guest console lands).

###### Returns

`Promise`\<`string`\>

##### exec()

> **exec**(`cmd`, `opts?`): `Promise`\<[`VsockExecResult`](#vsockexecresult)\>

Run a shell command inside the guest via the vsock exec-agent. Throws
BootError on non-zero exit; callers who want to inspect failure
should use `execRaw`.

Requires the rootfs to have the exec-agent running on vsock port 1978
(the standard debian base ships it). The vsock bridge is set up
automatically by `boot()` unless the caller pre-set MACHINEN_VSOCK.

###### Parameters

###### cmd

`string`

###### opts?

[`VsockExecOptions`](#vsockexecoptions)

###### Returns

`Promise`\<[`VsockExecResult`](#vsockexecresult)\>

##### execRaw()

> **execRaw**(`cmd`, `opts?`): `Promise`\<[`VsockExecResult`](#vsockexecresult)\>

Like `exec()` but returns non-zero exit codes instead of throwing.

###### Parameters

###### cmd

`string`

###### opts?

[`VsockExecOptions`](#vsockexecoptions)

###### Returns

`Promise`\<[`VsockExecResult`](#vsockexecresult)\>

##### execPty()

> **execPty**(`cmd`, `opts`): [`VsockExecPtyHandle`](#vsockexecptyhandle)

Run a shell command inside a pseudoterminal. Bidirectional bytes
flow between `opts.stdin` and `opts.stdout`; the returned handle's
`.resize(cols, rows)` propagates window-size changes (hook your
host's SIGWINCH).

Caller is responsible for putting the host terminal in raw mode
before calling and restoring it after `.result` settles — without
raw mode, Ctrl-C / arrow keys / etc. won't reach the guest as
untranslated bytes. See #133.

###### Parameters

###### cmd

`string`

###### opts

[`VsockExecPtyOptions`](#vsockexecptyoptions)

###### Returns

[`VsockExecPtyHandle`](#vsockexecptyhandle)

##### writeFile()

> **writeFile**(`guestPath`, `contents`, `opts?`): `Promise`\<`void`\>

Write `contents` to `guestPath` inside the VM. Convenience over
`vm.exec(...)` for the common "drop a config file from the host"
case — no quoting/heredoc gymnastics, binary-safe via base64.

Parent directories are created by default (`recursive: true`).
Pass `mode` to set the file mode (octal, e.g. `0o755`).
Pass `append: true` to append instead of overwrite.

Best for small-to-medium files (configs, scripts) — the contents
ride through a single vsock exec frame, so very large blobs are
better handled with `--mount` / `VsockFiles.push`.

Throws `ExecError` (`EXEC_NONZERO_EXIT`) if the underlying shell
write fails (e.g. permissions, full disk, missing `base64`).

###### Parameters

###### guestPath

`string`

###### contents

`string` \| `Buffer`\<`ArrayBufferLike`\>

###### opts?

[`WriteFileOptions`](#writefileoptions)

###### Returns

`Promise`\<`void`\>

###### Throws

EXEC_VSOCK_UNAVAILABLE | EXEC_NONZERO_EXIT |
  EXEC_AGENT_UNAVAILABLE (retryable) | EXEC_AGENT_TIMEOUT (retryable)

##### snapshot()

> **snapshot**(`opts`): `Promise`\<[`SnapshotResult`](#snapshotresult)\>

Write a snapshot bundle into `opts.outDir`.

With the default vmstate engine this is an incremental checkpoint:
the source VM keeps running, the first checkpoint in the VM's
chain carries full sparse RAM + `rootdisk.img`, and later
checkpoints carry RAM/rootdisk delta sections plus full vCPU,
GIC, virtio queue, and virtio-fs backend state. `restore()` walks
parent pointers and materializes a flat vmstate/rootdisk pair
before booting through the normal vmstate restore path.

With `MACHINEN_SNAPSHOT_ENGINE=criu`, this keeps the historical
process-tree behavior: CRIU image files live under `<outDir>/img/`,
`opts.leaveRunning: true` keeps the source alive, and the default
destructive CRIU snapshot powers the source off after the dump.
With `MACHINEN_SNAPSHOT_ENGINE=portable`, snapshot currently
refuses with an experimental/unsupported-workload error; the
semantic cross-ISA checkpoint implementation has not landed yet.

`mount-lower.sqfs` and `mount-upper.img` are reflinked from the
runtime's per-VM materialization (#272), so on APFS / btrfs / xfs
the snapshot is essentially free space-wise even for a large
mount payload — blocks stay shared until either side writes.

`SNAPSHOT_TIMEOUT` if the dump doesn't complete within
`opts.timeoutMs`; `SNAPSHOT_DUMP_FAILED` if the engine reports a
failed/incomplete dump.

Supported on both boot-owned and attach handles.

###### Parameters

###### opts

[`SnapshotOptions`](#snapshotoptions)

###### Returns

`Promise`\<[`SnapshotResult`](#snapshotresult)\>

##### memoryStats()

> **memoryStats**(): `Promise`\<[`MemoryStats`](#memorystats-1)\>

Read the host's view of this VM's memory: the ceiling the VMM was
sized at, the host RSS the VMM is currently holding, the bytes
the virtio-balloon device has reported back to the host, and the
count of lazy-restore pages the guest hasn't faulted in yet (#274).

Pure read, no side effects. The numbers come from:
  - `ceiling`           — captured at boot from the resolved
                           `MACHINEN_MEMORY` env (fork: from the
                           registry entry).
  - `hostRss`           — `/proc/<vmm>/status:VmRSS` on Linux,
                           `ps -o rss=` on Darwin. May be `null`
                           if the VMM exited between calls.
  - `balloonInflated`   — running total of bytes the balloon
                           device has reclaimed via free-page
                           reporting (`mmap MAP_FIXED` on the
                           reported runs). Read out of the shared
                           stats file the VMM mmaps at startup.
                           `0` when the VMM was launched without
                           `MACHINEN_STATS_FILE`.
  - `lazyPagesPending`  — for forks restored lazily (#266), the
                           count of pages the rewriter marked
                           PE_LAZY at restore time minus pages
                           served from `pages-*.img` over the
                           FUSE mount since. `0` for eager
                           restores and plain boots.

###### Returns

`Promise`\<[`MemoryStats`](#memorystats-1)\>

##### fork()

> **fork**(`opts?`): `Promise`\<[`VmHandle`](#vmhandle)\>

Snapshot this VM without killing it and immediately restore the
bundle into a new sibling VM. Both source and fork keep running,
independently addressable. See #216.

Wraps `vm.snapshot({ leaveRunning: true })` + `restore()` with
the safety defaults a fork wants:
  - `tcpKeep: false` (default) → the fork sees ECONNRESET on
    inherited TCP sockets, source keeps them. Set `tcpKeep: true`
    if you want both copies to share state (rarely correct).
  - `portForward: []` (default) → host ports are NOT inherited
    (they're global; source + fork would race). Pass new
    forwards explicitly.

Returns a handle to the forked VM. The source VM is unaffected
apart from being briefly frozen during `criu dump`.

Bundle lifecycle: when `opts.outDir` is set, the bundle is kept
and you can re-restore from it. When omitted, the bundle is
written to a temp dir and removed when the fork exits.

###### Parameters

###### opts?

[`ForkOptions`](#forkoptions)

###### Returns

`Promise`\<[`VmHandle`](#vmhandle)\>

***

### MemoryStats

Host-observable memory state for one VM (#274). All four fields are
snapshots of "now" — call `memoryStats()` again to refresh.

#### Properties

##### ceilingMib

> **ceilingMib**: `number`

Ceiling the VMM was sized at (MiB). The actual RSS climbs into
this on demand and is reclaimed by the balloon (#263 phase B);
the ceiling itself is fixed for the lifetime of the VM. `null`
when the runtime didn't pick the value (caller pre-set
`MACHINEN_MEMORY` via `vmmEnv`) — we won't honestly report a
number we don't own.

##### hostRssBytes

> **hostRssBytes**: `number`

Resident bytes the host kernel sees the VMM holding. `null`
when the VMM has exited or `/proc/<pid>/status` / `ps` couldn't
be read.

##### balloonInflatedBytes

> **balloonInflatedBytes**: `number`

Bytes the virtio-balloon device has reclaimed via free-page
reporting since the VMM started. Strictly increases over the
VMM's lifetime; if `hostRssBytes` is well below ceiling, balloon
reclaim is the reason. Read out of the shared stats file the VMM
writes via `MACHINEN_STATS_FILE`. `0` when the VMM was launched
without that env var.

##### lazyPagesPending

> **lazyPagesPending**: `number`

Pages the lazy-restore path (#266) has registered as PE_LAZY but
the guest hasn't faulted in yet. Approximated as
`entriesFlagged - bytesServedFromPagesImg / 4096`, clamped to
`>= 0`. `0` for eager restores and plain (non-restored) boots.

***

### WriteFileOptions

#### Properties

##### mode?

> `optional` **mode?**: `number`

Octal mode for the destination file (e.g. `0o755`). Default: leave as-is.

##### recursive?

> `optional` **recursive?**: `boolean`

`mkdir -p` the parent directory before writing. Default: true.

##### append?

> `optional` **append?**: `boolean`

Append to the file instead of overwriting. Default: false.

***

### SnapshotOptions

Options for `vm.snapshot(opts)`.

Live-share mount note (#273): VMs booted with `liveMounts: [...]`
are snapshottable. The runtime unmounts each FUSE mount before
CRIU dumps and (for `leaveRunning: true`) re-establishes them
after. Bytes are NOT captured into the bundle — only the host
path / guest path / mode get recorded in `meta.liveMounts` so
`restore()` can reconnect a live window on the other side. See
the `liveMounts` doc on `BootOptions` for the full contract.

#### Properties

##### outDir

> **outDir**: `string`

Directory the snapshot bundle is written to. Created if missing
and required to be empty (or absent) so a previous snapshot
can't be silently overwritten.

##### dumpCmd?

> `optional` **dumpCmd?**: `string`

Command to run in the guest to trigger the CRIU dump. Defaults to
`/sbin/machinen-dump`.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Wall-clock ceiling for the dump/checkpoint. Default 90s.

##### onLog?

> `optional` **onLog?**: [`OnLog`](#onlog)

Streaming log callback — fires for every byte the dump emits
(guest console + the dump exec). See #83. When both the snapshot
call and `boot({ onLog })` have a callback set, both fire.

##### leaveRunning?

> `optional` **leaveRunning?**: `boolean`

CRIU engine only: pass `--leave-running` to `criu dump` so the
source workload survives the snapshot. Vmstate checkpoints are
always non-destructive and ignore this flag.

Default under CRIU: false (destructive CRIU snapshot behavior).

##### tcpClose?

> `optional` **tcpClose?**: `boolean`

Omit `--tcp-established` from `criu dump`. Restored sockets come
back in CLOSED state — the workload sees ECONNRESET on first
I/O, which is the right semantic when the dump is the source for
a fork (otherwise both copies would race on the same connection
state). See #216.

Default: false (preserve TCP — current snapshot/restore behavior).

***

### SnapshotResult

#### Properties

##### engine

> **engine**: [`SnapshotEngine`](#snapshotengine)

Which backend produced the bundle.

##### snapDir

> **snapDir**: `string`

Absolute path to the snapshot bundle directory.

##### imgDir?

> `optional` **imgDir?**: `string`

Absolute path to the CRIU image directory inside the bundle.
Set by the criu engine only; undefined for vmstate bundles.

##### vmstatePath?

> `optional` **vmstatePath?**: `string`

Absolute path to the `.vmstate` whole-VM state file inside the
bundle. Set by the vmstate engine only; undefined for criu bundles.

##### elapsedMs

> **elapsedMs**: `number`

Time from `snapshot()` entry to completed bundle, in milliseconds.

##### consoleLog

> **consoleLog**: `string`

Guest console output captured during the dump.

***

### SnapshotFileIdentity

#### Properties

##### path?

> `optional` **path?**: `string`

Absolute source path when known on the snapshotting host.

##### sizeBytes

> **sizeBytes**: `number`

Logical file size in bytes.

##### sha256

> **sha256**: `string`

SHA-256 over the logical file bytes.

***

### VmstateSnapshotMeta

#### Properties

##### sourceBackend?

> `optional` **sourceBackend?**: [`VmstateBackend`](#vmstatebackend)

VMM backend that wrote `state.vmstate`.

##### guestArch?

> `optional` **guestArch?**: `"arm64"` \| `"amd64"` \| `"unknown"`

Guest CPU architecture captured in `state.vmstate`; restore must match.

##### topologyHash?

> `optional` **topologyHash?**: `string`

Topology hash from the .vmstate header (guest IPA/GIC/RAM layout).

##### memoryCeilingMib?

> `optional` **memoryCeilingMib?**: `number`

Guest RAM ceiling/layout the source VM booted with; not current host memory use.

##### guestPauth?

> `optional` **guestPauth?**: `object`

Pointer-auth state inferred from SCTLR_EL1 at snapshot time.

###### active?

> `optional` **active?**: `boolean`

###### sctlrEl1?

> `optional` **sctlrEl1?**: `string`

##### rootDisk?

> `optional` **rootDisk?**: `object` & [`SnapshotFileIdentity`](#snapshotfileidentity) \| \{ `mode`: `"delta"`; \} \| \{ `mode`: `"none"`; \}

Exact root block image needed by the resumed guest, a parent-relative delta, or explicit absence.

##### kernel?

> `optional` **kernel?**: [`SnapshotFileIdentity`](#snapshotfileidentity)

Kernel image identity when the source boot used an explicit kernel.

##### dtb?

> `optional` **dtb?**: [`SnapshotFileIdentity`](#snapshotfileidentity)

DTB identity when the source boot used an explicit DTB.

##### checkpoint?

> `optional` **checkpoint?**: `object`

Incremental checkpoint chain metadata for vmstate snapshots.

###### chainId

> **chainId**: `string`

New random chain id for this VM's lifetime.

###### sequence

> **sequence**: `number`

Per-chain checkpoint number, starting at 1.

###### parent?

> `optional` **parent?**: `string`

Relative path from this bundle to its parent bundle, absent for a base checkpoint.

###### ram

> **ram**: `"delta"` \| `"full"`

RAM section shape carried by this bundle.

###### rootDisk

> **rootDisk**: `"none"` \| `"delta"` \| `"full"`

Rootdisk section shape carried by this bundle.

***

### SnapshotMeta

#### Properties

##### engine?

> `optional` **engine?**: [`SnapshotEngine`](#snapshotengine)

Which backend wrote this bundle — `"criu"` (process-tree images
under `img/`), `"vmstate"` (whole-VM `state.vmstate`), or the
experimental `"portable"` semantic format. `restore()` auto-detects
CRIU/vmstate from the bundle's contents; portable remains explicit
opt-in so semantic process restore is not confused with exact VM
restore. Absent on bundles predating the vmstate engine (treated as
`"criu"`).

##### sourceName?

> `optional` **sourceName?**: `string`

Name passed to `boot({ name })` when the source VM was started.

##### sourceImage?

> `optional` **sourceImage?**: `string`

Absolute path of the rootfs tarball the source VM was booted with
(`boot({ image })` or its restored equivalent). `restore()` uses
this as the default rootfs, so the same-host quickstart works
without callers having to repeat the image path. Cross-host
restores need either the path to resolve on the new host, or an
explicit `image` override.

##### snappedAt

> **snappedAt**: `number`

ms epoch when `vm.snapshot()` returned.

##### vmstate?

> `optional` **vmstate?**: [`VmstateSnapshotMeta`](#vmstatesnapshotmeta)

Whole-VM `.vmstate` restore invariants. Present on new vmstate bundles.

##### mountDisk?

> `optional` **mountDisk?**: `object`

#272: when the source VM was booted with `mount: { host, guest }`,
the snapshot bundle includes both halves of the overlay so a
restore (same- or cross-host) can mount the same overlay without
consulting the host source dir.
  - `guest`: absolute guest path the overlay mounts at.
  - `lower`: basename of the squashfs RO lower in the bundle dir.
  - `upper`: basename of the ext4 RW upper in the bundle dir.

###### guest

> **guest**: `string`

###### lower

> **lower**: `string`

###### upper

> **upper**: `string`

##### liveMounts?

> `optional` **liveMounts?**: `object`[]

#273: live-share mounts (`liveMounts: [...]` at boot) the source
VM had at snapshot time. Unlike `mountDisk`, no bytes are captured
— `host` is the path on the host that was being live-shared,
recorded so `restore()` can re-establish the same window on the
restoring host. Each entry is the resolved config from the
source's `resolveLiveMounts()`:
  - `guest`: absolute guest path the mount lands at.
  - `host`:  absolute host path that was being shared.
  - `mode`:  `"ro"` or `"rw"`, the share's write semantics.

Restore policy: the bundle's recorded mounts are re-established
verbatim by default. Pass `restore({ liveMounts })` to override
per-guest `host`/`mode` — each override entry's `guest` must match
a recorded entry, else BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN.
Cross-host bundles where a recorded `host` doesn't exist on the
restoring host fail loudly via the boot-time existence check —
users remap with the override knob.

###### guest

> **guest**: `string`

###### host

> **host**: `string`

###### mode

> **mode**: `"ro"` \| `"rw"`

***

### ForkOptions

Fork = `vm.snapshot({ leaveRunning: true })` + `restore(...)` rolled
into one call. The shape mirrors `RestoreOptions` (so anything you
could pass to `restore()` works on a fork) plus two fork-only knobs:
`outDir` (where to write the bundle) and `tcpKeep` (snapshot half).

Notably this means `mount`, `liveMounts`, `env`, `guestCwd`, `memory`,
etc. are all settable on the fork — they take effect on the restored
sibling, not the source.

`snapDir` is omitted because `vm.fork()` produces the bundle itself.
Re-included here are the fork-shaped docs for `name`, `portForward`,
`timeoutMs`, and `onLog` so call sites see the fork-specific defaults
instead of the boot/restore ones.

#### Extends

- `Omit`\<[`RestoreOptions`](#restoreoptions), `"snapDir"`\>

#### Properties

##### outDir?

> `optional` **outDir?**: `string`

If set, the snapshot bundle is written here and kept after the
fork exits — re-restore from this path to spawn another sibling.
If omitted, the bundle is written to a temp dir and removed
when the fork's VMM exits.

##### tcpKeep?

> `optional` **tcpKeep?**: `boolean`

Default false: omit `--tcp-established` from the dump so the
fork sees ECONNRESET on sockets the source had open. Set true
to clone live TCP state into the fork (both VMs then race on
the same connection — only correct in narrow scenarios).

##### name?

> `optional` **name?**: `string`

Name for the forked VM. When omitted, restore()'s auto-naming
kicks in: `<sourceName>/<fork.pid>`.

###### Overrides

[`RestoreOptions`](#restoreoptions).[`name`](#name-11)

##### portForward?

> `optional` **portForward?**: `object`[]

Host→guest port forwards for the fork. NOT inherited from the
source — host ports are global and source + fork would race on
the same bind. Pass explicitly when the fork needs forwards.

###### hostPort

> **hostPort**: `number`

###### guestPort

> **guestPort**: `number`

###### hostAddr?

> `optional` **hostAddr?**: `string`

###### Overrides

[`BootOptions`](#bootoptions).[`portForward`](#portforward-2)

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Wall-clock ceiling for the restored fork's `wait()`. Defaults to
`null` (forever) — forks are typically long-lived sibling VMs and
interactive sessions can sit idle. Set a finite deadline if you
want the fork to be reaped after N ms of unresponsiveness. The
dump half uses `performSnapshot`'s own 90s default and isn't
configurable here.

###### Overrides

[`BootOptions`](#bootoptions).[`timeoutMs`](#timeoutms-5)

##### onLog?

> `optional` **onLog?**: [`OnLog`](#onlog)

Streaming log callback for the snapshot half. Same shape as
`vm.snapshot({ onLog })`. Also used by the restore boot.

###### Overrides

[`BootOptions`](#bootoptions).[`onLog`](#onlog-5)

##### lazy?

> `optional` **lazy?**: `boolean`

Opt into CRIU lazy-pages restore for the fork — the CRIU image directory
is mounted into the guest read-only via in-VMM virtio-fs and `criu restore
--lazy-pages` faults pages on demand. Default false: the runtime packs the
CRIU image into a tar on `/dev/vdb` and the guest does an eager load.

Lazy keeps fork RSS proportional to the pages the sibling actually
touches, not the full snapshot size. Worth setting when the source dumped
a large heap that the fork will only sample. The CLI currently forces
eager restore for `fork --detach --lazy`; use the runtime API directly if
you need to experiment with that combination.

###### Overrides

[`RestoreOptions`](#restoreoptions).[`lazy`](#lazy-1)

##### freeMemoryThreshold?

> `optional` **freeMemoryThreshold?**: `number`

Backpressure gate (#274). Fraction of host total memory that must
be free before `vm.fork()` is allowed to proceed; if `MemAvailable`
(Linux) / `vm_stat free+speculative+purgeable` (Darwin) drops below
`totalmem() * threshold`, the fork is refused with
`FORK_MEMORY_BACKPRESSURE`. Mirrors the throw-immediately shape of
#267's port-conflict gate — caller decides whether to retry.

Default 1% (`0.01`) — about 250 MiB on a 24 GiB host. The gate
exists to head off OOM kills, not to enforce a working-set
policy; bigger thresholds trip on real dev loops that boot
several VMs in sequence. Pass `0` to disable the gate entirely
(useful in tests or when you're knowingly running close to the
edge).

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Env vars exposed to the guest workload. Packed into the synthesized
`/machinen-config.json`. Distinct from `vmmEnv`, which only affects
the host-side VMM process.

###### Inherited from

[`BootOptions`](#bootoptions).[`env`](#env-9)

##### guestCwd?

> `optional` **guestCwd?**: `string`

Working directory for the guest cmd. Lands as `cwd` in the
synthesized `/machinen-config.json`; `/init` calls `chdir()` to
this path before exec'ing the cmd. Useful with `mount` /
`liveMounts` to land directly inside the share (e.g.
`guestCwd: "/mnt/workspace"`).

Must be absolute. Throws `BOOT_CWD_INVALID` for relative paths or
paths containing NULs. Same precedence as `cmd`/`env`: an
image-baked `cwd` is overridden by this field when both are set.

###### Inherited from

[`BootOptions`](#bootoptions).[`guestCwd`](#guestcwd-1)

##### rootDisk?

> `optional` **rootDisk?**: `string` \| `boolean`

Boot the guest with the rootfs on a virtio-blk device (`/dev/vda`)
instead of inflating the whole rootfs into a RAM-backed tmpfs via
the initramfs. See #114.

Default: `true` whenever `image` is set. The runtime materializes
an ext4 image from `image` (cached at
`~/.cache/machinen/rootfs/<sha256>.img`) and attaches it as the
rootdisk; the guest's `/init` mounts + chroots into it before
running the user cmd. Materialization needs `mke2fs` (or
`mkfs.ext4`) on PATH — `brew install e2fsprogs` on macOS, the
`e2fsprogs` package on Linux.

  - `string` — path to a pre-built ext4 `.img` file to attach
               directly. Skips the materialize step + cache.
  - `false`  — opt out: keep the cpio-as-rootfs path. The whole
               rootfs lands in a tmpfs at boot (RAM scales ~8×
               with rootfs size). Mostly an escape hatch for
               tooling that doesn't need disk-backed semantics
               (e.g. `provision()` itself).

###### Inherited from

[`BootOptions`](#bootoptions).[`rootDisk`](#rootdisk-2)

##### rootDiskSizeBytes?

> `optional` **rootDiskSizeBytes?**: `number`

Absolute target size (bytes) for the materialized rootdisk image.
Defaults to `max(2 GiB, treeBytes * 2.5)` — generous enough that
boot-time `npm install -g <large package>` / `apt install ...`
land without ENOSPC. Bump this for workloads that write more
(e.g. 8 GiB for a build tree, 16 GiB for a model cache).

The host file is sparse — unused capacity costs nothing on disk
until the guest writes. The guest's online ext4 grow (in /init)
resizes the on-disk filesystem to fill the file on every boot,
so bumping this against an existing cached image works without
a rematerialize.

Ignored when `rootDisk` is a string path (the caller-provided
image is taken as-is) or `rootDisk: false`. See #131.

###### Inherited from

[`BootOptions`](#bootoptions).[`rootDiskSizeBytes`](#rootdisksizebytes-1)

##### forkedFrom?

> `optional` **forkedFrom?**: `string`

Bookkeeping: absolute path to the snapshot bundle this VM was
forked from. Set by `restore({ snapDir })`; visible in
`machinen ls`. Plain `boot()` leaves it undefined.

###### Inherited from

[`BootOptions`](#bootoptions).[`forkedFrom`](#forkedfrom-2)

##### mount?

> `optional` **mount?**: `object`

A single host directory exposed to the guest as a writable
filesystem rooted under `/mnt/<guest>/`. Guest writes survive
snapshot/restore but never leak to the host source dir.

Implementation (#272): the runtime builds a content-addressed
read-only squashfs lower from `host` (cached in
`~/.cache/machinen/mountdisk/`) and a per-VM ext4 sparse upper
(4 GiB by default; bump via `mountDiskUpperSizeBytes`). Both
files are fd-passed to the VMM, surfacing inside the guest as
`/dev/vdc` (RO) and `/dev/vdd` (RW); /init layers them as a
single overlayfs at `<guest>/`. The squashfs lower stays
sealed for the VM's lifetime; writes go to the upper, which
is reflinked into snapshot bundles so forks see prior writes
without touching the source dir.

Trade-off vs. `liveMount`: `mount` is copy-into-disk-image (no
runtime channel back to the host source dir, snapshots cleanly,
but writes don't propagate to the host); `liveMount` is an in-VMM
virtio-fs pass-through (writes land on the host and restore/fork
re-establish the same guest mount topology). Pick `mount` for inputs the
guest may modify but the host shouldn't see; `liveMount` for shared scratch.

See #64 (original `mount`), #78 (`liveMount`), #114 (rootdisk
relocation; same shape), #272 (this overlay relocation).

###### host

> **host**: `string`

###### guest

> **guest**: `string`

###### Inherited from

[`BootOptions`](#bootoptions).[`mount`](#mount-2)

##### mountDiskUpperSizeBytes?

> `optional` **mountDiskUpperSizeBytes?**: `number`

Absolute target size (bytes) for the per-VM ext4 RW upper of
the `--mount` overlay (#272). Sparse, so unused capacity costs
nothing on the host disk. Mirrors `rootDiskSizeBytes` (#131) —
over-provision so the guest has plenty of room to write into
the mount before hitting ENOSPC.

Must be a positive multiple of 4096. Default 4 GiB.

###### Inherited from

[`BootOptions`](#bootoptions).[`mountDiskUpperSizeBytes`](#mountdiskuppersizebytes-1)

##### liveMounts?

> `optional` **liveMounts?**: `object`[]

Host directories exposed to the guest as live-share mounts (#78,
#332). Unlike `mount` (copy-once into the boot rootfs), these stay
connected to the host: the guest reads on demand and nothing is
copied at boot. `mode` defaults to `"rw"` — guest writes land on
the host (#151, #156). Set `"ro"` for a one-way share (host
caches, untrusted guests).

Each guest path must live under `/mnt/` (same rule as `mount`).
Repeatable up to 5 entries per VM — each is served by its own
in-VMM virtio-fs device (the VMM wires 5 virtio-fs slots). The
FUSE opcode handlers run inside the VMM and the guest mounts each
share directly with `mount -t virtiofs` — no agent process, no
vsock hop. Requires a guest kernel with `CONFIG_VIRTIO_FS` — every
machinen-built kernel has it. (The older FUSE-over-vsock transport
and its `protocol` knob were removed in #338.)

Snapshot / restore / fork (#273): liveMount has no guest-side
state worth checkpointing — reads come from the host on demand,
writes (in `"rw"`) land on the host immediately. The in-VMM
virtio-fs device persists across the CRIU dump, so the workload's
view of `/mnt/<guest>/` survives `vm.snapshot({ leaveRunning:
true })` and `vm.fork()` without an unmount/remount window.

Concurrent writes from multiple forks against the same host
directory are no different from any other shared filesystem —
each VM gets its own device but the runtime doesn't coordinate
writes between siblings. If two forks need non-overlapping write
surfaces, point each at a distinct `host` path or use `mount`
(copy-once, per-VM upper).

Restore on a host where the recorded `host` path doesn't exist:
fails loudly via `BOOT_MOUNT_HOST_NOT_FOUND`. Pass
`restore({ liveMounts: [...] })` to override per-`guest` —
each override entry's `guest` must match a recorded entry.

Security note: a live-share mount gives a compromised guest a
persistent channel back to the host filesystem. Containment keeps
that bounded to the configured host root. `mount` (copy-once) has
no such runtime channel and is strictly safer — prefer it for
inputs you don't need write-through on.

###### host

> **host**: `string`

###### guest

> **guest**: `string`

###### mode?

> `optional` **mode?**: `"ro"` \| `"rw"`

###### Inherited from

[`BootOptions`](#bootoptions).[`liveMounts`](#livemounts-3)

##### binary?

> `optional` **binary?**: `string`

Absolute or cwd-relative path to the VMM binary. Optional —
if omitted, `boot()` resolves it via `resolveVmmBinary()`.

###### Inherited from

[`BootOptions`](#bootoptions).[`binary`](#binary-3)

##### cwd?

> `optional` **cwd?**: `string`

Working directory for the VMM (for finding fixture files).

###### Inherited from

[`BootOptions`](#bootoptions).[`cwd`](#cwd-6)

##### args?

> `optional` **args?**: `string`[]

Extra argv for the VMM.

###### Inherited from

[`BootOptions`](#bootoptions).[`args`](#args-3)

##### kernel?

> `optional` **kernel?**: `string`

Path to the guest kernel Image. Forwarded as `MACHINEN_KERNEL`.

###### Inherited from

[`BootOptions`](#bootoptions).[`kernel`](#kernel-3)

##### dtb?

> `optional` **dtb?**: `string`

Path to the guest device-tree blob. Forwarded as `MACHINEN_DTB`.

###### Inherited from

[`BootOptions`](#bootoptions).[`dtb`](#dtb-3)

##### nested?

> `optional` **nested?**: `boolean`

Opt in to exposing arm64 EL2 / `/dev/kvm` to the guest so the
workload can start its own VMs. This is intentionally off by
default: it requires Linux/arm64 KVM with nested EL2 support, or
macOS 15+ on M3/M4-class Apple Silicon, and provider-level
snapshots of a nested-enabled VM are refused until EL2 vmstate
capture is audited.

When set, the runtime does a best-effort host preflight and passes
`MACHINEN_NESTED=1` to the VMM. The VMM's backend probe is still
authoritative.

###### Inherited from

[`BootOptions`](#bootoptions).[`nested`](#nested-2)

##### memory?

> `optional` **memory?**: `number`

Guest RAM ceiling, in MiB (decimal integer; no unit suffixes). The
VMM reads this as `MACHINEN_MEMORY` (#263 phase A). This is the
guest's memory layout limit, not the host memory used right now.
Defaults to `min(host_ram_mib / 2, 4096)` with a floor of 512 — a
modest ceiling for typical dev workloads. The ceiling is
approximately free until the guest touches a page (see
`packages/microvm/docs/memory.md`), but a bigger ceiling still
increases guest metadata and the possible high-water mark.

This is documented as a debug knob — most workloads should never
need to set it.

###### Inherited from

[`BootOptions`](#bootoptions).[`memory`](#memory-1)

##### pdeathsig?

> `optional` **pdeathsig?**: `boolean`

Wrap the VMM through the parent-death shim so it dies with this
runtime process. Default true — the right answer for the common
"boot, do work, exit" CLI flow.

Set to false when the VMM is supposed to outlive the spawning
process. `vm.fork()` (#216) sets this so the forked sibling
survives `cli fork` returning. Without it, the kqueue-watching
shim catches the CLI exit and SIGTERMs the fork mid-startup.

###### Inherited from

[`BootOptions`](#bootoptions).[`pdeathsig`](#pdeathsig-1)

##### vmmEnv?

> `optional` **vmmEnv?**: `Record`\<`string`, `string`\>

Env passed to the VMM process on the host side (not exposed to the
guest workload). Mostly for dev/test flags like `MACHINEN_BOOT_TEST`.

###### Inherited from

[`BootOptions`](#bootoptions).[`vmmEnv`](#vmmenv-2)

##### detached?

> `optional` **detached?**: `boolean`

Detach the VMM from the runtime parent so the parent can exit
while the VM keeps running (issue #150 phase 2). When set, `boot()`
blocks only until the guest produces its first console byte
(readiness signal) and then resolves a handle whose `.wait()` /
`.output()` no longer reflect the live VM — the parent has unrefed
the child and is free to exit.

Forces `pdeathsig: false` (otherwise the parent's exit kills the
VMM, defeating the purpose). Compatible with every other boot
option: gvproxy is tracked in the registry, live mounts are served
by in-VMM virtio-fs devices, and `mount` (squashfs+ext4 overlay)
is fd-passed to the VMM at spawn so the supervisor holds no live
state afterwards.

Cleanup of per-boot reflink disks, bundle dirs, and vsock UDS
directories normally happens in the parent's `child.once("exit")`
hook. After detach the parent is gone, so those leak until
`machinen gc` / `machinen stop` reaps them.

Reattach with `attach({ name | pid })` from another process —
the registry entry stays live, the vsock UDS is still listening.

###### Inherited from

[`BootOptions`](#bootoptions).[`detached`](#detached-1)

##### image?

> `optional` **image?**: `string`

Override the rootfs image used for the restore boot. Defaults
to whatever caller passes through `image`-equivalent — but
`restore()` always needs a base rootfs in the initramfs to
carry /sbin/machinen-restore + criu. Most callers pass the
release rootfs path here.

###### Inherited from

[`RestoreOptions`](#restoreoptions).[`image`](#image-2)

***

### AttachOptions

#### Properties

##### pid?

> `optional` **pid?**: `number`

Look up a VM by the host pid of its VMM process. Kernel-unique
while alive; mutually exclusive with `name`. Exactly one of
`pid` / `name` is required.

##### name?

> `optional` **name?**: `string`

Look up a VM by the name passed to `boot({ name })`.

##### onLog?

> `optional` **onLog?**: [`OnLog`](#onlog)

Streaming log callback — fires for every byte of output from execs
made through the returned handle. See #83. Guest kernel console is
not available on attach handles (it belongs to the process that
called `boot()`), so only `exec-stdout` / `exec-stderr` sources fire.

***

### BootOptions

#### Properties

##### image?

> `optional` **image?**: `string`

Path to a rootfs tarball to boot from (e.g. the output of
`provision()`, or an arch-specific base rootfs tarball shipped in
releases: `rootfs-debian-arm64.tar.gz` / `rootfs-debian-amd64.tar.gz`).
Paired with `cmd` — both required, or neither (test-mode binary
boots and snapshot-only restores both skip initramfs packing).

##### cmd?

> `optional` **cmd?**: `string`[]

Command to run inside the guest. Packed into the synthesized
`/machinen-config.json`. Paired with `image` — both required, or
neither.

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Env vars exposed to the guest workload. Packed into the synthesized
`/machinen-config.json`. Distinct from `vmmEnv`, which only affects
the host-side VMM process.

##### guestCwd?

> `optional` **guestCwd?**: `string`

Working directory for the guest cmd. Lands as `cwd` in the
synthesized `/machinen-config.json`; `/init` calls `chdir()` to
this path before exec'ing the cmd. Useful with `mount` /
`liveMounts` to land directly inside the share (e.g.
`guestCwd: "/mnt/workspace"`).

Must be absolute. Throws `BOOT_CWD_INVALID` for relative paths or
paths containing NULs. Same precedence as `cmd`/`env`: an
image-baked `cwd` is overridden by this field when both are set.

##### snapshot?

> `optional` **snapshot?**: `string` \| `false`

Attach a scratch virtio-blk device (`/dev/vdb`, or `/dev/vda` on
pre-#114 layouts) so this VM can be CRIU-snapshotted later via
`vm.snapshot()`. Three forms:

  - `undefined` (default) — the runtime auto-allocates a per-boot
    ~8 GiB sparse scratch in `tmpdir()` and unlinks it on VM exit.
    Disk usage stays at zero until the guest writes; the upside is
    every booted VM is snapshotable without re-booting. See #50.

  - `'<path>'` — caller-managed file. Used as-is (must exist).
    Used by `restore()` to attach a tar archive of the bundle's
    CRIU images on `/dev/vdb`; the guest's
    `/sbin/machinen-restore` untars it and runs `criu restore`.
    The runtime synthesizes `cmd: ['/sbin/machinen-restore']` if
    no other cmd is given.

  - `false` — opt out entirely. No `/dev/vdb` attached. Use when
    you don't need snapshot capability and want to skip the
    (sparse, but still nonzero) inode allocation — typical for
    fast-cycling test boots.

##### rootDisk?

> `optional` **rootDisk?**: `string` \| `boolean`

Boot the guest with the rootfs on a virtio-blk device (`/dev/vda`)
instead of inflating the whole rootfs into a RAM-backed tmpfs via
the initramfs. See #114.

Default: `true` whenever `image` is set. The runtime materializes
an ext4 image from `image` (cached at
`~/.cache/machinen/rootfs/<sha256>.img`) and attaches it as the
rootdisk; the guest's `/init` mounts + chroots into it before
running the user cmd. Materialization needs `mke2fs` (or
`mkfs.ext4`) on PATH — `brew install e2fsprogs` on macOS, the
`e2fsprogs` package on Linux.

  - `string` — path to a pre-built ext4 `.img` file to attach
               directly. Skips the materialize step + cache.
  - `false`  — opt out: keep the cpio-as-rootfs path. The whole
               rootfs lands in a tmpfs at boot (RAM scales ~8×
               with rootfs size). Mostly an escape hatch for
               tooling that doesn't need disk-backed semantics
               (e.g. `provision()` itself).

##### rootDiskSizeBytes?

> `optional` **rootDiskSizeBytes?**: `number`

Absolute target size (bytes) for the materialized rootdisk image.
Defaults to `max(2 GiB, treeBytes * 2.5)` — generous enough that
boot-time `npm install -g <large package>` / `apt install ...`
land without ENOSPC. Bump this for workloads that write more
(e.g. 8 GiB for a build tree, 16 GiB for a model cache).

The host file is sparse — unused capacity costs nothing on disk
until the guest writes. The guest's online ext4 grow (in /init)
resizes the on-disk filesystem to fill the file on every boot,
so bumping this against an existing cached image works without
a rematerialize.

Ignored when `rootDisk` is a string path (the caller-provided
image is taken as-is) or `rootDisk: false`. See #131.

##### name?

> `optional` **name?**: `string`

Optional name to register this VM under (`attach({ name })`
lookup key). Path-shaped strings ("worker/9012") are allowed.
Names are unique while live — `boot()` throws
`REGISTRY_NAME_IN_USE` if another VM already holds the name.

##### forkedFrom?

> `optional` **forkedFrom?**: `string`

Bookkeeping: absolute path to the snapshot bundle this VM was
forked from. Set by `restore({ snapDir })`; visible in
`machinen ls`. Plain `boot()` leaves it undefined.

##### mount?

> `optional` **mount?**: `object`

A single host directory exposed to the guest as a writable
filesystem rooted under `/mnt/<guest>/`. Guest writes survive
snapshot/restore but never leak to the host source dir.

Implementation (#272): the runtime builds a content-addressed
read-only squashfs lower from `host` (cached in
`~/.cache/machinen/mountdisk/`) and a per-VM ext4 sparse upper
(4 GiB by default; bump via `mountDiskUpperSizeBytes`). Both
files are fd-passed to the VMM, surfacing inside the guest as
`/dev/vdc` (RO) and `/dev/vdd` (RW); /init layers them as a
single overlayfs at `<guest>/`. The squashfs lower stays
sealed for the VM's lifetime; writes go to the upper, which
is reflinked into snapshot bundles so forks see prior writes
without touching the source dir.

Trade-off vs. `liveMount`: `mount` is copy-into-disk-image (no
runtime channel back to the host source dir, snapshots cleanly,
but writes don't propagate to the host); `liveMount` is an in-VMM
virtio-fs pass-through (writes land on the host and restore/fork
re-establish the same guest mount topology). Pick `mount` for inputs the
guest may modify but the host shouldn't see; `liveMount` for shared scratch.

See #64 (original `mount`), #78 (`liveMount`), #114 (rootdisk
relocation; same shape), #272 (this overlay relocation).

###### host

> **host**: `string`

###### guest

> **guest**: `string`

##### mountDiskUpperSizeBytes?

> `optional` **mountDiskUpperSizeBytes?**: `number`

Absolute target size (bytes) for the per-VM ext4 RW upper of
the `--mount` overlay (#272). Sparse, so unused capacity costs
nothing on the host disk. Mirrors `rootDiskSizeBytes` (#131) —
over-provision so the guest has plenty of room to write into
the mount before hitting ENOSPC.

Must be a positive multiple of 4096. Default 4 GiB.

##### liveMounts?

> `optional` **liveMounts?**: `object`[]

Host directories exposed to the guest as live-share mounts (#78,
#332). Unlike `mount` (copy-once into the boot rootfs), these stay
connected to the host: the guest reads on demand and nothing is
copied at boot. `mode` defaults to `"rw"` — guest writes land on
the host (#151, #156). Set `"ro"` for a one-way share (host
caches, untrusted guests).

Each guest path must live under `/mnt/` (same rule as `mount`).
Repeatable up to 5 entries per VM — each is served by its own
in-VMM virtio-fs device (the VMM wires 5 virtio-fs slots). The
FUSE opcode handlers run inside the VMM and the guest mounts each
share directly with `mount -t virtiofs` — no agent process, no
vsock hop. Requires a guest kernel with `CONFIG_VIRTIO_FS` — every
machinen-built kernel has it. (The older FUSE-over-vsock transport
and its `protocol` knob were removed in #338.)

Snapshot / restore / fork (#273): liveMount has no guest-side
state worth checkpointing — reads come from the host on demand,
writes (in `"rw"`) land on the host immediately. The in-VMM
virtio-fs device persists across the CRIU dump, so the workload's
view of `/mnt/<guest>/` survives `vm.snapshot({ leaveRunning:
true })` and `vm.fork()` without an unmount/remount window.

Concurrent writes from multiple forks against the same host
directory are no different from any other shared filesystem —
each VM gets its own device but the runtime doesn't coordinate
writes between siblings. If two forks need non-overlapping write
surfaces, point each at a distinct `host` path or use `mount`
(copy-once, per-VM upper).

Restore on a host where the recorded `host` path doesn't exist:
fails loudly via `BOOT_MOUNT_HOST_NOT_FOUND`. Pass
`restore({ liveMounts: [...] })` to override per-`guest` —
each override entry's `guest` must match a recorded entry.

Security note: a live-share mount gives a compromised guest a
persistent channel back to the host filesystem. Containment keeps
that bounded to the configured host root. `mount` (copy-once) has
no such runtime channel and is strictly safer — prefer it for
inputs you don't need write-through on.

###### host

> **host**: `string`

###### guest

> **guest**: `string`

###### mode?

> `optional` **mode?**: `"ro"` \| `"rw"`

##### portForward?

> `optional` **portForward?**: `object`[]

Host -> guest TCP port forwards installed via gvproxy's control
API. Each entry maps `hostPort` on the host (bound to `hostAddr`,
default `127.0.0.1`) to `guestPort` inside the guest.

###### hostPort

> **hostPort**: `number`

###### guestPort

> **guestPort**: `number`

###### hostAddr?

> `optional` **hostAddr?**: `string`

##### binary?

> `optional` **binary?**: `string`

Absolute or cwd-relative path to the VMM binary. Optional —
if omitted, `boot()` resolves it via `resolveVmmBinary()`.

##### cwd?

> `optional` **cwd?**: `string`

Working directory for the VMM (for finding fixture files).

##### args?

> `optional` **args?**: `string`[]

Extra argv for the VMM.

##### kernel?

> `optional` **kernel?**: `string`

Path to the guest kernel Image. Forwarded as `MACHINEN_KERNEL`.

##### dtb?

> `optional` **dtb?**: `string`

Path to the guest device-tree blob. Forwarded as `MACHINEN_DTB`.

##### nested?

> `optional` **nested?**: `boolean`

Opt in to exposing arm64 EL2 / `/dev/kvm` to the guest so the
workload can start its own VMs. This is intentionally off by
default: it requires Linux/arm64 KVM with nested EL2 support, or
macOS 15+ on M3/M4-class Apple Silicon, and provider-level
snapshots of a nested-enabled VM are refused until EL2 vmstate
capture is audited.

When set, the runtime does a best-effort host preflight and passes
`MACHINEN_NESTED=1` to the VMM. The VMM's backend probe is still
authoritative.

##### memory?

> `optional` **memory?**: `number`

Guest RAM ceiling, in MiB (decimal integer; no unit suffixes). The
VMM reads this as `MACHINEN_MEMORY` (#263 phase A). This is the
guest's memory layout limit, not the host memory used right now.
Defaults to `min(host_ram_mib / 2, 4096)` with a floor of 512 — a
modest ceiling for typical dev workloads. The ceiling is
approximately free until the guest touches a page (see
`packages/microvm/docs/memory.md`), but a bigger ceiling still
increases guest metadata and the possible high-water mark.

This is documented as a debug knob — most workloads should never
need to set it.

##### pdeathsig?

> `optional` **pdeathsig?**: `boolean`

Wrap the VMM through the parent-death shim so it dies with this
runtime process. Default true — the right answer for the common
"boot, do work, exit" CLI flow.

Set to false when the VMM is supposed to outlive the spawning
process. `vm.fork()` (#216) sets this so the forked sibling
survives `cli fork` returning. Without it, the kqueue-watching
shim catches the CLI exit and SIGTERMs the fork mid-startup.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Milliseconds to wait in `wait()` before giving up and rejecting.
Defaults to 60s. Pass `null` to wait forever.

##### vmmEnv?

> `optional` **vmmEnv?**: `Record`\<`string`, `string`\>

Env passed to the VMM process on the host side (not exposed to the
guest workload). Mostly for dev/test flags like `MACHINEN_BOOT_TEST`.

##### onLog?

> `optional` **onLog?**: [`OnLog`](#onlog)

Streaming log callback — fires for every byte of guest output:
kernel console (VMM stderr) and every exec invocation made through
the returned handle. See `LogEvent.source` to tell them apart. See
#83. For per-call output-only tees on a single exec, use
`vm.exec({ onStdout, onStderr })` instead.

##### detached?

> `optional` **detached?**: `boolean`

Detach the VMM from the runtime parent so the parent can exit
while the VM keeps running (issue #150 phase 2). When set, `boot()`
blocks only until the guest produces its first console byte
(readiness signal) and then resolves a handle whose `.wait()` /
`.output()` no longer reflect the live VM — the parent has unrefed
the child and is free to exit.

Forces `pdeathsig: false` (otherwise the parent's exit kills the
VMM, defeating the purpose). Compatible with every other boot
option: gvproxy is tracked in the registry, live mounts are served
by in-VMM virtio-fs devices, and `mount` (squashfs+ext4 overlay)
is fd-passed to the VMM at spawn so the supervisor holds no live
state afterwards.

Cleanup of per-boot reflink disks, bundle dirs, and vsock UDS
directories normally happens in the parent's `child.once("exit")`
hook. After detach the parent is gone, so those leak until
`machinen gc` / `machinen stop` reaps them.

Reattach with `attach({ name | pid })` from another process —
the registry entry stays live, the vsock UDS is still listening.

***

### RestoreOptions

#### Extends

- `Omit`\<[`BootOptions`](#bootoptions), `"snapshot"` \| `"image"` \| `"cmd"` \| `"name"`\>

#### Properties

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Env vars exposed to the guest workload. Packed into the synthesized
`/machinen-config.json`. Distinct from `vmmEnv`, which only affects
the host-side VMM process.

###### Inherited from

[`BootOptions`](#bootoptions).[`env`](#env-9)

##### guestCwd?

> `optional` **guestCwd?**: `string`

Working directory for the guest cmd. Lands as `cwd` in the
synthesized `/machinen-config.json`; `/init` calls `chdir()` to
this path before exec'ing the cmd. Useful with `mount` /
`liveMounts` to land directly inside the share (e.g.
`guestCwd: "/mnt/workspace"`).

Must be absolute. Throws `BOOT_CWD_INVALID` for relative paths or
paths containing NULs. Same precedence as `cmd`/`env`: an
image-baked `cwd` is overridden by this field when both are set.

###### Inherited from

[`BootOptions`](#bootoptions).[`guestCwd`](#guestcwd-1)

##### rootDisk?

> `optional` **rootDisk?**: `string` \| `boolean`

Boot the guest with the rootfs on a virtio-blk device (`/dev/vda`)
instead of inflating the whole rootfs into a RAM-backed tmpfs via
the initramfs. See #114.

Default: `true` whenever `image` is set. The runtime materializes
an ext4 image from `image` (cached at
`~/.cache/machinen/rootfs/<sha256>.img`) and attaches it as the
rootdisk; the guest's `/init` mounts + chroots into it before
running the user cmd. Materialization needs `mke2fs` (or
`mkfs.ext4`) on PATH — `brew install e2fsprogs` on macOS, the
`e2fsprogs` package on Linux.

  - `string` — path to a pre-built ext4 `.img` file to attach
               directly. Skips the materialize step + cache.
  - `false`  — opt out: keep the cpio-as-rootfs path. The whole
               rootfs lands in a tmpfs at boot (RAM scales ~8×
               with rootfs size). Mostly an escape hatch for
               tooling that doesn't need disk-backed semantics
               (e.g. `provision()` itself).

###### Inherited from

[`BootOptions`](#bootoptions).[`rootDisk`](#rootdisk-2)

##### rootDiskSizeBytes?

> `optional` **rootDiskSizeBytes?**: `number`

Absolute target size (bytes) for the materialized rootdisk image.
Defaults to `max(2 GiB, treeBytes * 2.5)` — generous enough that
boot-time `npm install -g <large package>` / `apt install ...`
land without ENOSPC. Bump this for workloads that write more
(e.g. 8 GiB for a build tree, 16 GiB for a model cache).

The host file is sparse — unused capacity costs nothing on disk
until the guest writes. The guest's online ext4 grow (in /init)
resizes the on-disk filesystem to fill the file on every boot,
so bumping this against an existing cached image works without
a rematerialize.

Ignored when `rootDisk` is a string path (the caller-provided
image is taken as-is) or `rootDisk: false`. See #131.

###### Inherited from

[`BootOptions`](#bootoptions).[`rootDiskSizeBytes`](#rootdisksizebytes-1)

##### forkedFrom?

> `optional` **forkedFrom?**: `string`

Bookkeeping: absolute path to the snapshot bundle this VM was
forked from. Set by `restore({ snapDir })`; visible in
`machinen ls`. Plain `boot()` leaves it undefined.

###### Inherited from

[`BootOptions`](#bootoptions).[`forkedFrom`](#forkedfrom-2)

##### mount?

> `optional` **mount?**: `object`

A single host directory exposed to the guest as a writable
filesystem rooted under `/mnt/<guest>/`. Guest writes survive
snapshot/restore but never leak to the host source dir.

Implementation (#272): the runtime builds a content-addressed
read-only squashfs lower from `host` (cached in
`~/.cache/machinen/mountdisk/`) and a per-VM ext4 sparse upper
(4 GiB by default; bump via `mountDiskUpperSizeBytes`). Both
files are fd-passed to the VMM, surfacing inside the guest as
`/dev/vdc` (RO) and `/dev/vdd` (RW); /init layers them as a
single overlayfs at `<guest>/`. The squashfs lower stays
sealed for the VM's lifetime; writes go to the upper, which
is reflinked into snapshot bundles so forks see prior writes
without touching the source dir.

Trade-off vs. `liveMount`: `mount` is copy-into-disk-image (no
runtime channel back to the host source dir, snapshots cleanly,
but writes don't propagate to the host); `liveMount` is an in-VMM
virtio-fs pass-through (writes land on the host and restore/fork
re-establish the same guest mount topology). Pick `mount` for inputs the
guest may modify but the host shouldn't see; `liveMount` for shared scratch.

See #64 (original `mount`), #78 (`liveMount`), #114 (rootdisk
relocation; same shape), #272 (this overlay relocation).

###### host

> **host**: `string`

###### guest

> **guest**: `string`

###### Inherited from

[`BootOptions`](#bootoptions).[`mount`](#mount-2)

##### mountDiskUpperSizeBytes?

> `optional` **mountDiskUpperSizeBytes?**: `number`

Absolute target size (bytes) for the per-VM ext4 RW upper of
the `--mount` overlay (#272). Sparse, so unused capacity costs
nothing on the host disk. Mirrors `rootDiskSizeBytes` (#131) —
over-provision so the guest has plenty of room to write into
the mount before hitting ENOSPC.

Must be a positive multiple of 4096. Default 4 GiB.

###### Inherited from

[`BootOptions`](#bootoptions).[`mountDiskUpperSizeBytes`](#mountdiskuppersizebytes-1)

##### liveMounts?

> `optional` **liveMounts?**: `object`[]

Host directories exposed to the guest as live-share mounts (#78,
#332). Unlike `mount` (copy-once into the boot rootfs), these stay
connected to the host: the guest reads on demand and nothing is
copied at boot. `mode` defaults to `"rw"` — guest writes land on
the host (#151, #156). Set `"ro"` for a one-way share (host
caches, untrusted guests).

Each guest path must live under `/mnt/` (same rule as `mount`).
Repeatable up to 5 entries per VM — each is served by its own
in-VMM virtio-fs device (the VMM wires 5 virtio-fs slots). The
FUSE opcode handlers run inside the VMM and the guest mounts each
share directly with `mount -t virtiofs` — no agent process, no
vsock hop. Requires a guest kernel with `CONFIG_VIRTIO_FS` — every
machinen-built kernel has it. (The older FUSE-over-vsock transport
and its `protocol` knob were removed in #338.)

Snapshot / restore / fork (#273): liveMount has no guest-side
state worth checkpointing — reads come from the host on demand,
writes (in `"rw"`) land on the host immediately. The in-VMM
virtio-fs device persists across the CRIU dump, so the workload's
view of `/mnt/<guest>/` survives `vm.snapshot({ leaveRunning:
true })` and `vm.fork()` without an unmount/remount window.

Concurrent writes from multiple forks against the same host
directory are no different from any other shared filesystem —
each VM gets its own device but the runtime doesn't coordinate
writes between siblings. If two forks need non-overlapping write
surfaces, point each at a distinct `host` path or use `mount`
(copy-once, per-VM upper).

Restore on a host where the recorded `host` path doesn't exist:
fails loudly via `BOOT_MOUNT_HOST_NOT_FOUND`. Pass
`restore({ liveMounts: [...] })` to override per-`guest` —
each override entry's `guest` must match a recorded entry.

Security note: a live-share mount gives a compromised guest a
persistent channel back to the host filesystem. Containment keeps
that bounded to the configured host root. `mount` (copy-once) has
no such runtime channel and is strictly safer — prefer it for
inputs you don't need write-through on.

###### host

> **host**: `string`

###### guest

> **guest**: `string`

###### mode?

> `optional` **mode?**: `"ro"` \| `"rw"`

###### Inherited from

[`BootOptions`](#bootoptions).[`liveMounts`](#livemounts-3)

##### portForward?

> `optional` **portForward?**: `object`[]

Host -> guest TCP port forwards installed via gvproxy's control
API. Each entry maps `hostPort` on the host (bound to `hostAddr`,
default `127.0.0.1`) to `guestPort` inside the guest.

###### hostPort

> **hostPort**: `number`

###### guestPort

> **guestPort**: `number`

###### hostAddr?

> `optional` **hostAddr?**: `string`

###### Inherited from

[`BootOptions`](#bootoptions).[`portForward`](#portforward-2)

##### binary?

> `optional` **binary?**: `string`

Absolute or cwd-relative path to the VMM binary. Optional —
if omitted, `boot()` resolves it via `resolveVmmBinary()`.

###### Inherited from

[`BootOptions`](#bootoptions).[`binary`](#binary-3)

##### cwd?

> `optional` **cwd?**: `string`

Working directory for the VMM (for finding fixture files).

###### Inherited from

[`BootOptions`](#bootoptions).[`cwd`](#cwd-6)

##### args?

> `optional` **args?**: `string`[]

Extra argv for the VMM.

###### Inherited from

[`BootOptions`](#bootoptions).[`args`](#args-3)

##### kernel?

> `optional` **kernel?**: `string`

Path to the guest kernel Image. Forwarded as `MACHINEN_KERNEL`.

###### Inherited from

[`BootOptions`](#bootoptions).[`kernel`](#kernel-3)

##### dtb?

> `optional` **dtb?**: `string`

Path to the guest device-tree blob. Forwarded as `MACHINEN_DTB`.

###### Inherited from

[`BootOptions`](#bootoptions).[`dtb`](#dtb-3)

##### nested?

> `optional` **nested?**: `boolean`

Opt in to exposing arm64 EL2 / `/dev/kvm` to the guest so the
workload can start its own VMs. This is intentionally off by
default: it requires Linux/arm64 KVM with nested EL2 support, or
macOS 15+ on M3/M4-class Apple Silicon, and provider-level
snapshots of a nested-enabled VM are refused until EL2 vmstate
capture is audited.

When set, the runtime does a best-effort host preflight and passes
`MACHINEN_NESTED=1` to the VMM. The VMM's backend probe is still
authoritative.

###### Inherited from

[`BootOptions`](#bootoptions).[`nested`](#nested-2)

##### memory?

> `optional` **memory?**: `number`

Guest RAM ceiling, in MiB (decimal integer; no unit suffixes). The
VMM reads this as `MACHINEN_MEMORY` (#263 phase A). This is the
guest's memory layout limit, not the host memory used right now.
Defaults to `min(host_ram_mib / 2, 4096)` with a floor of 512 — a
modest ceiling for typical dev workloads. The ceiling is
approximately free until the guest touches a page (see
`packages/microvm/docs/memory.md`), but a bigger ceiling still
increases guest metadata and the possible high-water mark.

This is documented as a debug knob — most workloads should never
need to set it.

###### Inherited from

[`BootOptions`](#bootoptions).[`memory`](#memory-1)

##### pdeathsig?

> `optional` **pdeathsig?**: `boolean`

Wrap the VMM through the parent-death shim so it dies with this
runtime process. Default true — the right answer for the common
"boot, do work, exit" CLI flow.

Set to false when the VMM is supposed to outlive the spawning
process. `vm.fork()` (#216) sets this so the forked sibling
survives `cli fork` returning. Without it, the kqueue-watching
shim catches the CLI exit and SIGTERMs the fork mid-startup.

###### Inherited from

[`BootOptions`](#bootoptions).[`pdeathsig`](#pdeathsig-1)

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Milliseconds to wait in `wait()` before giving up and rejecting.
Defaults to 60s. Pass `null` to wait forever.

###### Inherited from

[`BootOptions`](#bootoptions).[`timeoutMs`](#timeoutms-5)

##### vmmEnv?

> `optional` **vmmEnv?**: `Record`\<`string`, `string`\>

Env passed to the VMM process on the host side (not exposed to the
guest workload). Mostly for dev/test flags like `MACHINEN_BOOT_TEST`.

###### Inherited from

[`BootOptions`](#bootoptions).[`vmmEnv`](#vmmenv-2)

##### onLog?

> `optional` **onLog?**: [`OnLog`](#onlog)

Streaming log callback — fires for every byte of guest output:
kernel console (VMM stderr) and every exec invocation made through
the returned handle. See `LogEvent.source` to tell them apart. See
#83. For per-call output-only tees on a single exec, use
`vm.exec({ onStdout, onStderr })` instead.

###### Inherited from

[`BootOptions`](#bootoptions).[`onLog`](#onlog-5)

##### detached?

> `optional` **detached?**: `boolean`

Detach the VMM from the runtime parent so the parent can exit
while the VM keeps running (issue #150 phase 2). When set, `boot()`
blocks only until the guest produces its first console byte
(readiness signal) and then resolves a handle whose `.wait()` /
`.output()` no longer reflect the live VM — the parent has unrefed
the child and is free to exit.

Forces `pdeathsig: false` (otherwise the parent's exit kills the
VMM, defeating the purpose). Compatible with every other boot
option: gvproxy is tracked in the registry, live mounts are served
by in-VMM virtio-fs devices, and `mount` (squashfs+ext4 overlay)
is fd-passed to the VMM at spawn so the supervisor holds no live
state afterwards.

Cleanup of per-boot reflink disks, bundle dirs, and vsock UDS
directories normally happens in the parent's `child.once("exit")`
hook. After detach the parent is gone, so those leak until
`machinen gc` / `machinen stop` reaps them.

Reattach with `attach({ name | pid })` from another process —
the registry entry stays live, the vsock UDS is still listening.

###### Inherited from

[`BootOptions`](#bootoptions).[`detached`](#detached-1)

##### snapDir

> **snapDir**: `string`

Snapshot bundle directory produced by `vm.snapshot()`. Vmstate bundles
contain `state.vmstate`, `rootdisk.img`, and `meta.json`; legacy CRIU
bundles contain `img/<crius>` and `meta.json`.

##### image?

> `optional` **image?**: `string`

Override the rootfs image used for the restore boot. Defaults
to whatever caller passes through `image`-equivalent — but
`restore()` always needs a base rootfs in the initramfs to
carry /sbin/machinen-restore + criu. Most callers pass the
release rootfs path here.

##### name?

> `optional` **name?**: `string`

Optional explicit name for the restored VM. When omitted, the
fork is auto-named `<sourceName>/<pid>` after spawn so it stays
unique under the source's namespace.

##### lazy?

> `optional` **lazy?**: `boolean`

Opt into CRIU lazy-pages restore — the CRIU image directory is mounted
into the guest read-only via in-VMM virtio-fs and `criu restore
--lazy-pages` faults pages on demand (#266). Default false: the runtime
packs the CRIU image into a tar on `/dev/vdb`, the guest's
`/sbin/machinen-restore` untars it into tmpfs, and CRIU does an eager
load.

Eager is still the CRIU default because lazy restore is a specialized
UFFD path. The historical runaway free-page-reporting blocker under
lazy is fixed in #290 by the in-tree kernel patch that stops the buddy
allocator from clearing the Reported flag during a merge.

***

### VsockWinsizeOptions

#### Properties

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

How long to keep retrying the UDS connect. Default 10s.

##### retryMs?

> `optional` **retryMs?**: `number`

Poll interval in ms while retrying. Default 250.

## Type Aliases

### BunRuntimeAdapterProbe

> **BunRuntimeAdapterProbe** = \{ `runtime`: `"bun"`; `available`: `true`; `version`: `string`; `semanticGraph`: `"sidecar-required"`; `packagedExecutable?`: [`BunPackagedExecutableIdentity`](#bunpackagedexecutableidentity); `refusal?`: [`RuntimeAdapterRefusal`](#runtimeadapterrefusal); \} \| \{ `runtime`: `"bun"`; `available`: `false`; `refusal`: [`RuntimeAdapterRefusal`](#runtimeadapterrefusal); `packagedExecutable?`: [`BunPackagedExecutableIdentity`](#bunpackagedexecutableidentity); \}

***

### ErrorCode

> **ErrorCode** = *typeof* [`ErrorCode`](#errorcode)\[keyof *typeof* [`ErrorCode`](#errorcode)\]

***

### JsBuildIdentityVerification

> **JsBuildIdentityVerification** = \{ `accepted`: `true`; `current`: [`JsBuildIdentitySidecar`](#jsbuildidentitysidecar); \} \| \{ `accepted`: `false`; `current`: [`JsBuildIdentitySidecar`](#jsbuildidentitysidecar); `refusal`: [`RuntimeAdapterRefusal`](#runtimeadapterrefusal); \}

***

### LogEvent

> **LogEvent** = [`ChunkLogEvent`](#chunklogevent) \| [`PhaseLogEvent`](#phaselogevent)

***

### OnLog

> **OnLog** = (`evt`) => `void`

#### Parameters

##### evt

[`LogEvent`](#logevent)

#### Returns

`void`

***

### NodeAsyncContinuationKind

> **NodeAsyncContinuationKind** = `"timer"` \| `"promise"` \| `"native-callback"`

***

### NodeAsyncContinuationHandlers

> **NodeAsyncContinuationHandlers** = `Record`\<`string`, (`payload`) => `unknown`\>

***

### NodeRuntimeAdapterResourceKind

> **NodeRuntimeAdapterResourceKind** = [`RuntimeAdapterResourceKind`](#runtimeadapterresourcekind)

***

### PidStatus

> **PidStatus** = `"alive"` \| `"dead"` \| `"recycled"`

Result of `validatePid` — easy to switch on at the call site.

***

### RuntimeAdapterArch

> **RuntimeAdapterArch** = `"arm64"` \| `"amd64"`

***

### RuntimeAdapterRuntimeName

> **RuntimeAdapterRuntimeName** = `"node"` \| `"bun"` \| `"custom"`

***

### RuntimeAdapterTransport

> **RuntimeAdapterTransport** = `"stdio-json"` \| `"sidecar-json"`

***

### RuntimeAdapterValueKind

> **RuntimeAdapterValueKind** = `"undefined"` \| `"null"` \| `"boolean"` \| `"number"` \| `"bigint"` \| `"string"` \| `"bytes"` \| `"ref"` \| `"array"`

***

### RuntimeAdapterObjectKind

> **RuntimeAdapterObjectKind** = `"object"` \| `"array"` \| `"map"` \| `"set"` \| `"date"` \| `"regexp"` \| `"error"` \| `"array-buffer"` \| `"typed-array"` \| `"opaque"`

***

### RuntimeAdapterResourceKind

> **RuntimeAdapterResourceKind** = `"argv"` \| `"env"` \| `"cwd"` \| `"fd"` \| `"file"` \| `"socket"` \| `"timer"` \| `"signal"` \| `"child-process"` \| `"worker"` \| `"pty"` \| `"fs-watch"` \| `"native-handle"` \| `"unknown"`

***

### RuntimeAdapterResourceState

> **RuntimeAdapterResourceState** = `"captured"` \| `"refused"` \| `"unsupported"`

***

### RuntimeAdapterModuleKind

> **RuntimeAdapterModuleKind** = `"builtin"` \| `"workspace"` \| `"relative"` \| `"external"` \| `"artifact"`

***

### RuntimeAdapterMappingRole

> **RuntimeAdapterMappingRole** = `"runtime-roots"` \| `"runtime-object-graph"` \| `"runtime-resources"` \| `"runtime-metadata"`

***

### RuntimeAdapterRefusalCode

> **RuntimeAdapterRefusalCode** = *typeof* [`runtimeAdapterRefusalCodes`](#runtimeadapterrefusalcodes)\[`number`\]

***

### RuntimeAdapterValue

> **RuntimeAdapterValue** = \{ `kind`: `"undefined"`; \} \| \{ `kind`: `"null"`; \} \| \{ `kind`: `"boolean"`; `value`: `boolean`; \} \| \{ `kind`: `"number"`; `value`: `number`; \} \| \{ `kind`: `"bigint"`; `decimal`: `string`; \} \| \{ `kind`: `"string"`; `value`: `string`; \} \| \{ `kind`: `"bytes"`; `base64`: `string`; `byteLength`: `number`; \} \| \{ `kind`: `"ref"`; `objectId`: `string`; \} \| \{ `kind`: `"array"`; `items`: [`RuntimeAdapterValue`](#runtimeadaptervalue)[]; \}

***

### RuntimeAdapterJsonSchema

> **RuntimeAdapterJsonSchema** = `Record`\<`string`, `unknown`\>

***

### VmstateBackend

> **VmstateBackend** = `"hvf"` \| `"kvm"` \| `"unknown"`

On-disk shape of the bundle's `meta.json`. Read by `restore()`
to reconstruct the source VM's name when registering the fork.

***

### ImageConfig

> **ImageConfig** = `object`

Shape of the optional `./machinen-config.json` baked into a rootfs
tarball by `provision({ cmd, env })`. `boot()` reads it via
`readImageConfig()` so callers don't need to re-pass `cmd`/`env` on
every boot. `warmImageConfigCache()` accepts the same shape so a
tarball-producing tool can pre-populate the lookup cache.

#### Properties

##### cmd?

> `optional` **cmd?**: `string`[]

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

##### cwd?

> `optional` **cwd?**: `string`

***

### SnapshotEngine

> **SnapshotEngine** = `"criu"` \| `"vmstate"` \| `"portable"`

## Variables

### STATS\_FILE\_SIZE

> `const` **STATS\_FILE\_SIZE**: `24` = `24`

***

### ErrorCode

> `const` **ErrorCode**: `object`

#### Type Declaration

##### BOOT\_VMM\_MISSING

> `readonly` **BOOT\_VMM\_MISSING**: `"BOOT_VMM_MISSING"` = `"BOOT_VMM_MISSING"`

##### BOOT\_VMM\_PACKAGE\_BROKEN

> `readonly` **BOOT\_VMM\_PACKAGE\_BROKEN**: `"BOOT_VMM_PACKAGE_BROKEN"` = `"BOOT_VMM_PACKAGE_BROKEN"`

##### BOOT\_IMAGE\_NOT\_FOUND

> `readonly` **BOOT\_IMAGE\_NOT\_FOUND**: `"BOOT_IMAGE_NOT_FOUND"` = `"BOOT_IMAGE_NOT_FOUND"`

##### BOOT\_SNAPSHOT\_NOT\_FOUND

> `readonly` **BOOT\_SNAPSHOT\_NOT\_FOUND**: `"BOOT_SNAPSHOT_NOT_FOUND"` = `"BOOT_SNAPSHOT_NOT_FOUND"`

##### BOOT\_KERNEL\_NOT\_FOUND

> `readonly` **BOOT\_KERNEL\_NOT\_FOUND**: `"BOOT_KERNEL_NOT_FOUND"` = `"BOOT_KERNEL_NOT_FOUND"`

##### BOOT\_DTB\_NOT\_FOUND

> `readonly` **BOOT\_DTB\_NOT\_FOUND**: `"BOOT_DTB_NOT_FOUND"` = `"BOOT_DTB_NOT_FOUND"`

##### BOOT\_CMD\_WITHOUT\_IMAGE

> `readonly` **BOOT\_CMD\_WITHOUT\_IMAGE**: `"BOOT_CMD_WITHOUT_IMAGE"` = `"BOOT_CMD_WITHOUT_IMAGE"`

##### BOOT\_CMD\_MISSING

> `readonly` **BOOT\_CMD\_MISSING**: `"BOOT_CMD_MISSING"` = `"BOOT_CMD_MISSING"`

##### BOOT\_CWD\_INVALID

> `readonly` **BOOT\_CWD\_INVALID**: `"BOOT_CWD_INVALID"` = `"BOOT_CWD_INVALID"`

##### BOOT\_MOUNT\_INVALID

> `readonly` **BOOT\_MOUNT\_INVALID**: `"BOOT_MOUNT_INVALID"` = `"BOOT_MOUNT_INVALID"`

##### BOOT\_MOUNT\_HOST\_NOT\_FOUND

> `readonly` **BOOT\_MOUNT\_HOST\_NOT\_FOUND**: `"BOOT_MOUNT_HOST_NOT_FOUND"` = `"BOOT_MOUNT_HOST_NOT_FOUND"`

##### BOOT\_LIVE\_MOUNT\_OVERRIDE\_UNKNOWN

> `readonly` **BOOT\_LIVE\_MOUNT\_OVERRIDE\_UNKNOWN**: `"BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN"` = `"BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN"`

##### BOOT\_PORT\_FORWARD\_INVALID

> `readonly` **BOOT\_PORT\_FORWARD\_INVALID**: `"BOOT_PORT_FORWARD_INVALID"` = `"BOOT_PORT_FORWARD_INVALID"`

##### BOOT\_PORT\_FORWARD\_CONFLICT

> `readonly` **BOOT\_PORT\_FORWARD\_CONFLICT**: `"BOOT_PORT_FORWARD_CONFLICT"` = `"BOOT_PORT_FORWARD_CONFLICT"`

##### BOOT\_PORT\_FORWARD\_NO\_GVPROXY

> `readonly` **BOOT\_PORT\_FORWARD\_NO\_GVPROXY**: `"BOOT_PORT_FORWARD_NO_GVPROXY"` = `"BOOT_PORT_FORWARD_NO_GVPROXY"`

##### BOOT\_PORT\_FORWARD\_IN\_USE

> `readonly` **BOOT\_PORT\_FORWARD\_IN\_USE**: `"BOOT_PORT_FORWARD_IN_USE"` = `"BOOT_PORT_FORWARD_IN_USE"`

##### BOOT\_PACK\_FAILED

> `readonly` **BOOT\_PACK\_FAILED**: `"BOOT_PACK_FAILED"` = `"BOOT_PACK_FAILED"`

##### BOOT\_TIMEOUT

> `readonly` **BOOT\_TIMEOUT**: `"BOOT_TIMEOUT"` = `"BOOT_TIMEOUT"`

##### BOOT\_DETACHED\_READINESS\_FAILED

> `readonly` **BOOT\_DETACHED\_READINESS\_FAILED**: `"BOOT_DETACHED_READINESS_FAILED"` = `"BOOT_DETACHED_READINESS_FAILED"`

##### BOOT\_MEMORY\_INVALID

> `readonly` **BOOT\_MEMORY\_INVALID**: `"BOOT_MEMORY_INVALID"` = `"BOOT_MEMORY_INVALID"`

##### BOOT\_NESTED\_VIRT\_UNSUPPORTED

> `readonly` **BOOT\_NESTED\_VIRT\_UNSUPPORTED**: `"BOOT_NESTED_VIRT_UNSUPPORTED"` = `"BOOT_NESTED_VIRT_UNSUPPORTED"`

##### BOOT\_VMSTATE\_UNSUPPORTED

> `readonly` **BOOT\_VMSTATE\_UNSUPPORTED**: `"BOOT_VMSTATE_UNSUPPORTED"` = `"BOOT_VMSTATE_UNSUPPORTED"`

##### BOOT\_VMSTATE\_RESEED\_FAILED

> `readonly` **BOOT\_VMSTATE\_RESEED\_FAILED**: `"BOOT_VMSTATE_RESEED_FAILED"` = `"BOOT_VMSTATE_RESEED_FAILED"`

##### BOOT\_PORTABLE\_UNSUPPORTED

> `readonly` **BOOT\_PORTABLE\_UNSUPPORTED**: `"BOOT_PORTABLE_UNSUPPORTED"` = `"BOOT_PORTABLE_UNSUPPORTED"`

##### FORK\_MEMORY\_BACKPRESSURE

> `readonly` **FORK\_MEMORY\_BACKPRESSURE**: `"FORK_MEMORY_BACKPRESSURE"` = `"FORK_MEMORY_BACKPRESSURE"`

##### BOOT\_MOUNTDISK\_TOOL\_MISSING

> `readonly` **BOOT\_MOUNTDISK\_TOOL\_MISSING**: `"BOOT_MOUNTDISK_TOOL_MISSING"` = `"BOOT_MOUNTDISK_TOOL_MISSING"`

##### EXEC\_VSOCK\_UNAVAILABLE

> `readonly` **EXEC\_VSOCK\_UNAVAILABLE**: `"EXEC_VSOCK_UNAVAILABLE"` = `"EXEC_VSOCK_UNAVAILABLE"`

##### EXEC\_AGENT\_UNAVAILABLE

> `readonly` **EXEC\_AGENT\_UNAVAILABLE**: `"EXEC_AGENT_UNAVAILABLE"` = `"EXEC_AGENT_UNAVAILABLE"`

##### EXEC\_AGENT\_TIMEOUT

> `readonly` **EXEC\_AGENT\_TIMEOUT**: `"EXEC_AGENT_TIMEOUT"` = `"EXEC_AGENT_TIMEOUT"`

##### EXEC\_NONZERO\_EXIT

> `readonly` **EXEC\_NONZERO\_EXIT**: `"EXEC_NONZERO_EXIT"` = `"EXEC_NONZERO_EXIT"`

##### EXEC\_PROTOCOL

> `readonly` **EXEC\_PROTOCOL**: `"EXEC_PROTOCOL"` = `"EXEC_PROTOCOL"`

##### SNAPSHOT\_NO\_DISK

> `readonly` **SNAPSHOT\_NO\_DISK**: `"SNAPSHOT_NO_DISK"` = `"SNAPSHOT_NO_DISK"`

##### SNAPSHOT\_DUMP\_FAILED

> `readonly` **SNAPSHOT\_DUMP\_FAILED**: `"SNAPSHOT_DUMP_FAILED"` = `"SNAPSHOT_DUMP_FAILED"`

##### SNAPSHOT\_TIMEOUT

> `readonly` **SNAPSHOT\_TIMEOUT**: `"SNAPSHOT_TIMEOUT"` = `"SNAPSHOT_TIMEOUT"`

##### SNAPSHOT\_PORTABLE\_UNSUPPORTED

> `readonly` **SNAPSHOT\_PORTABLE\_UNSUPPORTED**: `"SNAPSHOT_PORTABLE_UNSUPPORTED"` = `"SNAPSHOT_PORTABLE_UNSUPPORTED"`

##### PROVISION\_BASE\_NOT\_FOUND

> `readonly` **PROVISION\_BASE\_NOT\_FOUND**: `"PROVISION_BASE_NOT_FOUND"` = `"PROVISION_BASE_NOT_FOUND"`

##### PROVISION\_KERNEL\_NOT\_FOUND

> `readonly` **PROVISION\_KERNEL\_NOT\_FOUND**: `"PROVISION_KERNEL_NOT_FOUND"` = `"PROVISION_KERNEL_NOT_FOUND"`

##### PROVISION\_DTB\_NOT\_FOUND

> `readonly` **PROVISION\_DTB\_NOT\_FOUND**: `"PROVISION_DTB_NOT_FOUND"` = `"PROVISION_DTB_NOT_FOUND"`

##### PROVISION\_ASSETS\_DIR\_INVALID

> `readonly` **PROVISION\_ASSETS\_DIR\_INVALID**: `"PROVISION_ASSETS_DIR_INVALID"` = `"PROVISION_ASSETS_DIR_INVALID"`

##### PROVISION\_INSTALL\_HOOK\_FAILED

> `readonly` **PROVISION\_INSTALL\_HOOK\_FAILED**: `"PROVISION_INSTALL_HOOK_FAILED"` = `"PROVISION_INSTALL_HOOK_FAILED"`

##### PROVISION\_DISK\_TOO\_SMALL

> `readonly` **PROVISION\_DISK\_TOO\_SMALL**: `"PROVISION_DISK_TOO_SMALL"` = `"PROVISION_DISK_TOO_SMALL"`

##### ROOTFS\_IMG\_TOOL\_MISSING

> `readonly` **ROOTFS\_IMG\_TOOL\_MISSING**: `"ROOTFS_IMG_TOOL_MISSING"` = `"ROOTFS_IMG_TOOL_MISSING"`

##### REGISTRY\_VM\_NOT\_FOUND

> `readonly` **REGISTRY\_VM\_NOT\_FOUND**: `"REGISTRY_VM_NOT_FOUND"` = `"REGISTRY_VM_NOT_FOUND"`

##### REGISTRY\_NAME\_IN\_USE

> `readonly` **REGISTRY\_NAME\_IN\_USE**: `"REGISTRY_NAME_IN_USE"` = `"REGISTRY_NAME_IN_USE"`

##### FILES\_HOST\_DIR\_NOT\_FOUND

> `readonly` **FILES\_HOST\_DIR\_NOT\_FOUND**: `"FILES_HOST_DIR_NOT_FOUND"` = `"FILES_HOST_DIR_NOT_FOUND"`

##### FILES\_AGENT\_UNAVAILABLE

> `readonly` **FILES\_AGENT\_UNAVAILABLE**: `"FILES_AGENT_UNAVAILABLE"` = `"FILES_AGENT_UNAVAILABLE"`

##### MOUNT\_PATH\_INVALID

> `readonly` **MOUNT\_PATH\_INVALID**: `"MOUNT_PATH_INVALID"` = `"MOUNT_PATH_INVALID"`

##### MOUNT\_PATH\_ESCAPE

> `readonly` **MOUNT\_PATH\_ESCAPE**: `"MOUNT_PATH_ESCAPE"` = `"MOUNT_PATH_ESCAPE"`

##### SECRETS\_VALUE\_INVALID

> `readonly` **SECRETS\_VALUE\_INVALID**: `"SECRETS_VALUE_INVALID"` = `"SECRETS_VALUE_INVALID"`

##### SECRETS\_AGENT\_UNAVAILABLE

> `readonly` **SECRETS\_AGENT\_UNAVAILABLE**: `"SECRETS_AGENT_UNAVAILABLE"` = `"SECRETS_AGENT_UNAVAILABLE"`

##### WINSIZE\_AGENT\_UNAVAILABLE

> `readonly` **WINSIZE\_AGENT\_UNAVAILABLE**: `"WINSIZE_AGENT_UNAVAILABLE"` = `"WINSIZE_AGENT_UNAVAILABLE"`

##### SANDBOX\_ID\_DUPLICATE

> `readonly` **SANDBOX\_ID\_DUPLICATE**: `"SANDBOX_ID_DUPLICATE"` = `"SANDBOX_ID_DUPLICATE"`

##### SANDBOX\_ID\_UNKNOWN

> `readonly` **SANDBOX\_ID\_UNKNOWN**: `"SANDBOX_ID_UNKNOWN"` = `"SANDBOX_ID_UNKNOWN"`

##### CACHE\_BIND\_FAILED

> `readonly` **CACHE\_BIND\_FAILED**: `"CACHE_BIND_FAILED"` = `"CACHE_BIND_FAILED"`

##### GVPROXY\_NOT\_FOUND

> `readonly` **GVPROXY\_NOT\_FOUND**: `"GVPROXY_NOT_FOUND"` = `"GVPROXY_NOT_FOUND"`

##### GVPROXY\_EXPOSE\_FAILED

> `readonly` **GVPROXY\_EXPOSE\_FAILED**: `"GVPROXY_EXPOSE_FAILED"` = `"GVPROXY_EXPOSE_FAILED"`

##### GVPROXY\_PORT\_IN\_USE

> `readonly` **GVPROXY\_PORT\_IN\_USE**: `"GVPROXY_PORT_IN_USE"` = `"GVPROXY_PORT_IN_USE"`

##### GVPROXY\_INSTALL\_FAILED

> `readonly` **GVPROXY\_INSTALL\_FAILED**: `"GVPROXY_INSTALL_FAILED"` = `"GVPROXY_INSTALL_FAILED"`

##### GVPROXY\_SPAWN\_FAILED

> `readonly` **GVPROXY\_SPAWN\_FAILED**: `"GVPROXY_SPAWN_FAILED"` = `"GVPROXY_SPAWN_FAILED"`

##### MKINITRAMFS\_BUNDLE\_INVALID

> `readonly` **MKINITRAMFS\_BUNDLE\_INVALID**: `"MKINITRAMFS_BUNDLE_INVALID"` = `"MKINITRAMFS_BUNDLE_INVALID"`

##### MKINITRAMFS\_WORKSPACE\_INVALID

> `readonly` **MKINITRAMFS\_WORKSPACE\_INVALID**: `"MKINITRAMFS_WORKSPACE_INVALID"` = `"MKINITRAMFS_WORKSPACE_INVALID"`

##### MKINITRAMFS\_WORKSPACE\_TOO\_LARGE

> `readonly` **MKINITRAMFS\_WORKSPACE\_TOO\_LARGE**: `"MKINITRAMFS_WORKSPACE_TOO_LARGE"` = `"MKINITRAMFS_WORKSPACE_TOO_LARGE"`

##### MKINITRAMFS\_BASE\_EXTRACT\_FAILED

> `readonly` **MKINITRAMFS\_BASE\_EXTRACT\_FAILED**: `"MKINITRAMFS_BASE_EXTRACT_FAILED"` = `"MKINITRAMFS_BASE_EXTRACT_FAILED"`

##### MKINITRAMFS\_INIT\_MISSING

> `readonly` **MKINITRAMFS\_INIT\_MISSING**: `"MKINITRAMFS_INIT_MISSING"` = `"MKINITRAMFS_INIT_MISSING"`

##### PARSE\_FLAG\_UNKNOWN

> `readonly` **PARSE\_FLAG\_UNKNOWN**: `"PARSE_FLAG_UNKNOWN"` = `"PARSE_FLAG_UNKNOWN"`

##### PARSE\_FLAG\_MISSING\_VALUE

> `readonly` **PARSE\_FLAG\_MISSING\_VALUE**: `"PARSE_FLAG_MISSING_VALUE"` = `"PARSE_FLAG_MISSING_VALUE"`

##### PARSE\_FLAG\_DUPLICATE

> `readonly` **PARSE\_FLAG\_DUPLICATE**: `"PARSE_FLAG_DUPLICATE"` = `"PARSE_FLAG_DUPLICATE"`

##### PARSE\_FLAG\_MALFORMED

> `readonly` **PARSE\_FLAG\_MALFORMED**: `"PARSE_FLAG_MALFORMED"` = `"PARSE_FLAG_MALFORMED"`

##### PARSE\_PORT\_INVALID

> `readonly` **PARSE\_PORT\_INVALID**: `"PARSE_PORT_INVALID"` = `"PARSE_PORT_INVALID"`

***

### VsockExec

> `const` **VsockExec**: `object`

#### Type Declaration

##### run()

> `readonly` **run**(`udsPath`, `cmd`, `opts?`): `Promise`\<[`VsockExecResult`](#vsockexecresult)\>

###### Parameters

###### udsPath

`string`

###### cmd

`string`

###### opts?

[`VsockExecOptions`](#vsockexecoptions) = `{}`

###### Returns

`Promise`\<[`VsockExecResult`](#vsockexecresult)\>

###### Throws

EXEC_AGENT_UNAVAILABLE (retryable) |
  EXEC_AGENT_TIMEOUT (retryable) | EXEC_PROTOCOL

##### startPty()

> `readonly` **startPty**(`udsPath`, `cmd`, `opts`): [`VsockExecPtyHandle`](#vsockexecptyhandle)

PTY-mode session against the exec-agent (#133). Bytes flow
bidirectionally between `opts.stdin` (host keystrokes) and
`opts.stdout` (workload's pty output); the returned handle's
`.resize(cols, rows)` propagates window-size changes to the
guest's `ioctl(TIOCSWINSZ)`, and `.cancel()` disconnects (the
agent then closes its master fd, which sends SIGHUP to the
workload's session and reaps the child).

Resolves with `{ exitCode }` once the workload exits and the
agent emits the X frame. The stdin listener attaches eagerly —
the caller is responsible for putting the host terminal in raw
mode beforehand (so Ctrl-C, arrows, etc. reach the guest as
untranslated bytes) and restoring it after `result` settles.

Connect retries are intentionally absent here: PTY sessions are
always against an already-running VM whose agent is up. If the
UDS isn't reachable on the first try, that's a real error worth
surfacing — not a transient bring-up race like the `run()` path.

###### Parameters

###### udsPath

`string`

###### cmd

`string`

###### opts

[`VsockExecPtyOptions`](#vsockexecptyoptions)

###### Returns

[`VsockExecPtyHandle`](#vsockexecptyhandle)

***

### VsockFiles

> `const` **VsockFiles**: `object`

#### Type Declaration

##### push()

> `readonly` **push**(`udsPath`, `hostDir`, `guestPath`, `opts?`): `Promise`\<`void`\>

Stream `hostDir`'s contents into the guest at `guestPath`. Any
existing files at that path are overwritten (standard `tar -x`
semantics). If `guestPath` doesn't exist, the agent creates it.

###### Parameters

###### udsPath

`string`

###### hostDir

`string`

###### guestPath

`string`

###### opts?

[`VsockFilesOptions`](#vsockfilesoptions) = `{}`

###### Returns

`Promise`\<`void`\>

##### pull()

> `readonly` **pull**(`udsPath`, `guestPath`, `hostDir`, `opts?`): `Promise`\<`void`\>

Stream a tar of `guestPath` from the guest and untar into
`hostDir`. `hostDir` is created if missing.

###### Parameters

###### udsPath

`string`

###### guestPath

`string`

###### hostDir

`string`

###### opts?

[`VsockFilesOptions`](#vsockfilesoptions) = `{}`

###### Returns

`Promise`\<`void`\>

***

### DEFAULT\_FREE\_MEMORY\_THRESHOLD

> `const` **DEFAULT\_FREE\_MEMORY\_THRESHOLD**: `0.01` = `0.01`

Default fraction of host memory we require to be free before
`vm.fork()` is allowed to proceed. The gate exists to keep a
runaway script from OOM-killing arbitrary host processes — not
to enforce a particular working-set policy. 1% on a 24 GiB host
= ~250 MiB, enough headroom for the lazy-restore criu spawn
(#266) plus a typical workload's UFFD page-in burst, while still
tripping early enough that a host with only a few hundred MiB
free fails fast instead of triggering the kernel OOM killer.

Smoke-test rationale: a host running `pnpm smoke-tests` sees
five sequential VMs leave it with ~1 GiB free in steady state.
Anything stricter than this default trips on real-world dev
loops; anything looser stops being a meaningful gate.

***

### NODE\_RUNTIME\_NATIVE\_RESOURCE\_KINDS

> `const` **NODE\_RUNTIME\_NATIVE\_RESOURCE\_KINDS**: readonly \[`"argv"`, `"env"`, `"cwd"`, `"file"`, `"fd"`, `"socket"`, `"timer"`, `"child-process"`, `"worker"`, `"pty"`, `"fs-watch"`, `"native-handle"`\]

***

### RUNTIME\_ADAPTER\_BUNDLE\_FILE

> `const` **RUNTIME\_ADAPTER\_BUNDLE\_FILE**: `"runtime-adapter.json"` = `"runtime-adapter.json"`

***

### runtimeAdapterRefusalCodes

> `const` **runtimeAdapterRefusalCodes**: readonly \[`"architecture-pair-unsupported"`, `"architecture-unsupported"`, `"fd-kind-unsupported"`, `"feature-unsupported"`, `"object-unsupported"`, `"resource-unsupported"`, `"runtime-adapter-missing"`, `"runtime-heap-unsupported"`, `"target-build-mismatch"`\]

***

### runtimeAdapterSchemas

> `const` **runtimeAdapterSchemas**: `object`

#### Type Declaration

##### document

> `readonly` **document**: `object`

###### document.$schema

> `readonly` **$schema**: `"https://json-schema.org/draft/2020-12/schema"` = `"https://json-schema.org/draft/2020-12/schema"`

###### document.$id

> `readonly` **$id**: `"https://machinen.dev/schemas/runtime-adapter/document.schema.json"` = `"https://machinen.dev/schemas/runtime-adapter/document.schema.json"`

###### document.title

> `readonly` **title**: `"Machinen runtime adapter document"` = `"Machinen runtime adapter document"`

###### document.type

> `readonly` **type**: `"object"` = `"object"`

###### document.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.required

> `readonly` **required**: readonly \[`"formatVersion"`, `"adapter"`, `"target"`, `"runtime"`, `"build"`, `"process"`, `"graph"`, `"resources"`, `"restore"`, `"bundleMapping"`, `"unsupported"`\]

###### document.properties

> `readonly` **properties**: `object`

###### document.properties.formatVersion

> `readonly` **formatVersion**: `object`

###### document.properties.formatVersion.const

> `readonly` **const**: `1` = `RUNTIME_ADAPTER_FORMAT_VERSION`

###### document.properties.adapter

> `readonly` **adapter**: `object`

###### document.properties.adapter.type

> `readonly` **type**: `"object"` = `"object"`

###### document.properties.adapter.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.properties.adapter.required

> `readonly` **required**: readonly \[`"id"`, `"protocolVersion"`, `"runtime"`, `"name"`, `"features"`, `"entrypoints"`\]

###### document.properties.adapter.properties

> `readonly` **properties**: `object`

###### document.properties.adapter.properties.id

> `readonly` **id**: `object`

###### document.properties.adapter.properties.id.type

> `readonly` **type**: `"string"` = `"string"`

###### document.properties.adapter.properties.id.minLength

> `readonly` **minLength**: `1` = `1`

###### document.properties.adapter.properties.protocolVersion

> `readonly` **protocolVersion**: `object`

###### document.properties.adapter.properties.protocolVersion.const

> `readonly` **const**: `1` = `RUNTIME_ADAPTER_PROTOCOL_VERSION`

###### document.properties.adapter.properties.runtime

> `readonly` **runtime**: `object`

###### document.properties.adapter.properties.runtime.enum

> `readonly` **enum**: readonly \[`"node"`, `"bun"`, `"custom"`\] = `RUNTIME_ADAPTER_RUNTIME_NAMES`

###### document.properties.adapter.properties.name

> `readonly` **name**: `object`

###### document.properties.adapter.properties.name.type

> `readonly` **type**: `"string"` = `"string"`

###### document.properties.adapter.properties.name.minLength

> `readonly` **minLength**: `1` = `1`

###### document.properties.adapter.properties.version

> `readonly` **version**: `object`

###### document.properties.adapter.properties.version.type

> `readonly` **type**: `"string"` = `"string"`

###### document.properties.adapter.properties.version.minLength

> `readonly` **minLength**: `1` = `1`

###### document.properties.adapter.properties.features

> `readonly` **features**: `object`

###### document.properties.adapter.properties.features.type

> `readonly` **type**: `"array"` = `"array"`

###### document.properties.adapter.properties.features.items

> `readonly` **items**: `object`

###### document.properties.adapter.properties.features.items.type

> `readonly` **type**: `"string"` = `"string"`

###### document.properties.adapter.properties.features.items.minLength

> `readonly` **minLength**: `1` = `1`

###### document.properties.adapter.properties.features.uniqueItems

> `readonly` **uniqueItems**: `true` = `true`

###### document.properties.adapter.properties.entrypoints

> `readonly` **entrypoints**: `object`

###### document.properties.adapter.properties.entrypoints.$ref

> `readonly` **$ref**: `"#/$defs/entrypoints"` = `"#/$defs/entrypoints"`

###### document.properties.target

> `readonly` **target**: `object`

###### document.properties.target.type

> `readonly` **type**: `"object"` = `"object"`

###### document.properties.target.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.properties.target.required

> `readonly` **required**: readonly \[`"id"`, `"name"`, `"executable"`, `"sourceGuestArch"`, `"allowedTargetGuestArchs"`\]

###### document.properties.target.properties

> `readonly` **properties**: `object`

###### document.properties.target.properties.id

> `readonly` **id**: `object`

###### document.properties.target.properties.id.type

> `readonly` **type**: `"string"` = `"string"`

###### document.properties.target.properties.id.minLength

> `readonly` **minLength**: `1` = `1`

###### document.properties.target.properties.name

> `readonly` **name**: `object`

###### document.properties.target.properties.name.type

> `readonly` **type**: `"string"` = `"string"`

###### document.properties.target.properties.name.minLength

> `readonly` **minLength**: `1` = `1`

###### document.properties.target.properties.executable

> `readonly` **executable**: `object`

###### document.properties.target.properties.executable.type

> `readonly` **type**: `"string"` = `"string"`

###### document.properties.target.properties.executable.minLength

> `readonly` **minLength**: `1` = `1`

###### document.properties.target.properties.sourceGuestArch

> `readonly` **sourceGuestArch**: `object`

###### document.properties.target.properties.sourceGuestArch.enum

> `readonly` **enum**: readonly \[`"arm64"`, `"amd64"`\] = `RUNTIME_ADAPTER_ARCHES`

###### document.properties.target.properties.allowedTargetGuestArchs

> `readonly` **allowedTargetGuestArchs**: `object`

###### document.properties.target.properties.allowedTargetGuestArchs.type

> `readonly` **type**: `"array"` = `"array"`

###### document.properties.target.properties.allowedTargetGuestArchs.minItems

> `readonly` **minItems**: `1` = `1`

###### document.properties.target.properties.allowedTargetGuestArchs.uniqueItems

> `readonly` **uniqueItems**: `true` = `true`

###### document.properties.target.properties.allowedTargetGuestArchs.items

> `readonly` **items**: `object`

###### document.properties.target.properties.allowedTargetGuestArchs.items.enum

> `readonly` **enum**: readonly \[`"arm64"`, `"amd64"`\] = `RUNTIME_ADAPTER_ARCHES`

###### document.properties.runtime

> `readonly` **runtime**: `object`

###### document.properties.runtime.$ref

> `readonly` **$ref**: `"#/$defs/runtime"` = `"#/$defs/runtime"`

###### document.properties.build

> `readonly` **build**: `object`

###### document.properties.build.$ref

> `readonly` **$ref**: `"#/$defs/build"` = `"#/$defs/build"`

###### document.properties.process

> `readonly` **process**: `object`

###### document.properties.process.$ref

> `readonly` **$ref**: `"#/$defs/process"` = `"#/$defs/process"`

###### document.properties.graph

> `readonly` **graph**: `object`

###### document.properties.graph.$ref

> `readonly` **$ref**: `"#/$defs/graph"` = `"#/$defs/graph"`

###### document.properties.resources

> `readonly` **resources**: `object`

###### document.properties.resources.$ref

> `readonly` **$ref**: `"#/$defs/resources"` = `"#/$defs/resources"`

###### document.properties.restore

> `readonly` **restore**: `object`

###### document.properties.restore.$ref

> `readonly` **$ref**: `"#/$defs/restore"` = `"#/$defs/restore"`

###### document.properties.bundleMapping

> `readonly` **bundleMapping**: `object`

###### document.properties.bundleMapping.$ref

> `readonly` **$ref**: `"#/$defs/bundleMapping"` = `"#/$defs/bundleMapping"`

###### document.properties.unsupported

> `readonly` **unsupported**: [`RuntimeAdapterJsonSchema`](#runtimeadapterjsonschema) = `UNSUPPORTED_SCHEMA`

###### document.$defs

> `readonly` **$defs**: `object`

###### document.$defs.refusal

> `readonly` **refusal**: [`RuntimeAdapterJsonSchema`](#runtimeadapterjsonschema) = `REFUSAL_SCHEMA`

###### document.$defs.unsupported

> `readonly` **unsupported**: [`RuntimeAdapterJsonSchema`](#runtimeadapterjsonschema) = `UNSUPPORTED_SCHEMA`

###### document.$defs.value

> `readonly` **value**: [`RuntimeAdapterJsonSchema`](#runtimeadapterjsonschema) = `VALUE_SCHEMA`

###### document.$defs.entrypoint

> `readonly` **entrypoint**: `object`

###### document.$defs.entrypoint.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.entrypoint.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.entrypoint.required

> `readonly` **required**: readonly \[`"command"`, `"args"`, `"transport"`\]

###### document.$defs.entrypoint.properties

> `readonly` **properties**: `object`

###### document.$defs.entrypoint.properties.command

> `readonly` **command**: `object`

###### document.$defs.entrypoint.properties.command.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.entrypoint.properties.command.minLength

> `readonly` **minLength**: `1` = `1`

###### document.$defs.entrypoint.properties.args

> `readonly` **args**: `object`

###### document.$defs.entrypoint.properties.args.type

> `readonly` **type**: `"array"` = `"array"`

###### document.$defs.entrypoint.properties.args.items

> `readonly` **items**: `object`

###### document.$defs.entrypoint.properties.args.items.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.entrypoint.properties.transport

> `readonly` **transport**: `object`

###### document.$defs.entrypoint.properties.transport.enum

> `readonly` **enum**: readonly \[`"stdio-json"`, `"sidecar-json"`\] = `RUNTIME_ADAPTER_TRANSPORTS`

###### document.$defs.entrypoint.properties.env

> `readonly` **env**: `object`

###### document.$defs.entrypoint.properties.env.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.entrypoint.properties.env.additionalProperties

> `readonly` **additionalProperties**: `object`

###### document.$defs.entrypoint.properties.env.additionalProperties.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.entrypoints

> `readonly` **entrypoints**: `object`

###### document.$defs.entrypoints.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.entrypoints.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.entrypoints.required

> `readonly` **required**: readonly \[`"capture"`, `"restore"`\]

###### document.$defs.entrypoints.properties

> `readonly` **properties**: `object`

###### document.$defs.entrypoints.properties.capture

> `readonly` **capture**: `object`

###### document.$defs.entrypoints.properties.capture.$ref

> `readonly` **$ref**: `"#/$defs/entrypoint"` = `"#/$defs/entrypoint"`

###### document.$defs.entrypoints.properties.restore

> `readonly` **restore**: `object`

###### document.$defs.entrypoints.properties.restore.$ref

> `readonly` **$ref**: `"#/$defs/entrypoint"` = `"#/$defs/entrypoint"`

###### document.$defs.runtime

> `readonly` **runtime**: `object`

###### document.$defs.runtime.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.runtime.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.runtime.required

> `readonly` **required**: readonly \[`"name"`, `"version"`, `"serializerCompatibility"`\]

###### document.$defs.runtime.properties

> `readonly` **properties**: `object`

###### document.$defs.runtime.properties.name

> `readonly` **name**: `object`

###### document.$defs.runtime.properties.name.enum

> `readonly` **enum**: readonly \[`"node"`, `"bun"`, `"custom"`\] = `RUNTIME_ADAPTER_RUNTIME_NAMES`

###### document.$defs.runtime.properties.version

> `readonly` **version**: `object`

###### document.$defs.runtime.properties.version.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.runtime.properties.version.minLength

> `readonly` **minLength**: `1` = `1`

###### document.$defs.runtime.properties.engine

> `readonly` **engine**: `object`

###### document.$defs.runtime.properties.engine.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.runtime.properties.engine.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.runtime.properties.engine.required

> `readonly` **required**: readonly \[`"name"`, `"version"`\]

###### document.$defs.runtime.properties.engine.properties

> `readonly` **properties**: `object`

###### document.$defs.runtime.properties.engine.properties.name

> `readonly` **name**: `object`

###### document.$defs.runtime.properties.engine.properties.name.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.runtime.properties.engine.properties.name.minLength

> `readonly` **minLength**: `1` = `1`

###### document.$defs.runtime.properties.engine.properties.version

> `readonly` **version**: `object`

###### document.$defs.runtime.properties.engine.properties.version.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.runtime.properties.engine.properties.version.minLength

> `readonly` **minLength**: `1` = `1`

###### document.$defs.runtime.properties.serializerCompatibility

> `readonly` **serializerCompatibility**: `object`

###### document.$defs.runtime.properties.serializerCompatibility.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.runtime.properties.serializerCompatibility.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.runtime.properties.serializerCompatibility.required

> `readonly` **required**: readonly \[`"semanticGraph"`, `"rawHeap"`\]

###### document.$defs.runtime.properties.serializerCompatibility.properties

> `readonly` **properties**: `object`

###### document.$defs.runtime.properties.serializerCompatibility.properties.semanticGraph

> `readonly` **semanticGraph**: `object`

###### document.$defs.runtime.properties.serializerCompatibility.properties.semanticGraph.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.runtime.properties.serializerCompatibility.properties.semanticGraph.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.runtime.properties.serializerCompatibility.properties.semanticGraph.required

> `readonly` **required**: readonly \[`"supported"`, `"format"`\]

###### document.$defs.runtime.properties.serializerCompatibility.properties.semanticGraph.properties

> `readonly` **properties**: `object`

###### document.$defs.runtime.properties.serializerCompatibility.properties.semanticGraph.properties.supported

> `readonly` **supported**: `object`

###### document.$defs.runtime.properties.serializerCompatibility.properties.semanticGraph.properties.supported.const

> `readonly` **const**: `true` = `true`

###### document.$defs.runtime.properties.serializerCompatibility.properties.semanticGraph.properties.format

> `readonly` **format**: `object`

###### document.$defs.runtime.properties.serializerCompatibility.properties.semanticGraph.properties.format.const

> `readonly` **const**: `"machinen-runtime-adapter-v1"` = `"machinen-runtime-adapter-v1"`

###### document.$defs.runtime.properties.serializerCompatibility.properties.rawHeap

> `readonly` **rawHeap**: `object`

###### document.$defs.runtime.properties.serializerCompatibility.properties.rawHeap.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.runtime.properties.serializerCompatibility.properties.rawHeap.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.runtime.properties.serializerCompatibility.properties.rawHeap.required

> `readonly` **required**: readonly \[`"supported"`, `"refusal"`\]

###### document.$defs.runtime.properties.serializerCompatibility.properties.rawHeap.properties

> `readonly` **properties**: `object`

###### document.$defs.runtime.properties.serializerCompatibility.properties.rawHeap.properties.supported

> `readonly` **supported**: `object`

###### document.$defs.runtime.properties.serializerCompatibility.properties.rawHeap.properties.supported.const

> `readonly` **const**: `false` = `false`

###### document.$defs.runtime.properties.serializerCompatibility.properties.rawHeap.properties.refusal

> `readonly` **refusal**: [`RuntimeAdapterJsonSchema`](#runtimeadapterjsonschema) = `REFUSAL_SCHEMA`

###### document.$defs.runtime.properties.serializerCompatibility.properties.v8Serialize

> `readonly` **v8Serialize**: `object`

###### document.$defs.runtime.properties.serializerCompatibility.properties.v8Serialize.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.runtime.properties.serializerCompatibility.properties.structuredClone

> `readonly` **structuredClone**: `object`

###### document.$defs.runtime.properties.serializerCompatibility.properties.structuredClone.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.runtime.properties.serializerCompatibility.properties.heapSnapshot

> `readonly` **heapSnapshot**: `object`

###### document.$defs.runtime.properties.serializerCompatibility.properties.heapSnapshot.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.build

> `readonly` **build**: `object`

###### document.$defs.build.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.build.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.build.required

> `readonly` **required**: readonly \[`"identity"`, `"modules"`\]

###### document.$defs.build.properties

> `readonly` **properties**: `object`

###### document.$defs.build.properties.identity

> `readonly` **identity**: `object`

###### document.$defs.build.properties.identity.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.build.properties.identity.additionalProperties

> `readonly` **additionalProperties**: `object`

###### document.$defs.build.properties.identity.additionalProperties.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.build.properties.identity.additionalProperties.pattern

> `readonly` **pattern**: `"^[0-9A-Fa-f]{64}$"` = `"^[0-9A-Fa-f]{64}$"`

###### document.$defs.build.properties.modules

> `readonly` **modules**: `object`

###### document.$defs.build.properties.modules.type

> `readonly` **type**: `"array"` = `"array"`

###### document.$defs.build.properties.modules.items

> `readonly` **items**: `object`

###### document.$defs.build.properties.modules.items.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.build.properties.modules.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.build.properties.modules.items.required

> `readonly` **required**: readonly \[`"specifier"`, `"kind"`\]

###### document.$defs.build.properties.modules.items.properties

> `readonly` **properties**: `object`

###### document.$defs.build.properties.modules.items.properties.specifier

> `readonly` **specifier**: `object`

###### document.$defs.build.properties.modules.items.properties.specifier.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.build.properties.modules.items.properties.specifier.minLength

> `readonly` **minLength**: `1` = `1`

###### document.$defs.build.properties.modules.items.properties.kind

> `readonly` **kind**: `object`

###### document.$defs.build.properties.modules.items.properties.kind.enum

> `readonly` **enum**: readonly \[`"builtin"`, `"workspace"`, `"relative"`, `"external"`, `"artifact"`\] = `RUNTIME_ADAPTER_MODULE_KINDS`

###### document.$defs.build.properties.modules.items.properties.sha256

> `readonly` **sha256**: `object`

###### document.$defs.build.properties.modules.items.properties.sha256.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.build.properties.modules.items.properties.sha256.pattern

> `readonly` **pattern**: `"^[0-9A-Fa-f]{64}$"` = `"^[0-9A-Fa-f]{64}$"`

###### document.$defs.process

> `readonly` **process**: `object`

###### document.$defs.process.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.process.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.process.required

> `readonly` **required**: readonly \[`"argv"`, `"env"`, `"cwd"`\]

###### document.$defs.process.properties

> `readonly` **properties**: `object`

###### document.$defs.process.properties.argv

> `readonly` **argv**: `object`

###### document.$defs.process.properties.argv.type

> `readonly` **type**: `"array"` = `"array"`

###### document.$defs.process.properties.argv.minItems

> `readonly` **minItems**: `1` = `1`

###### document.$defs.process.properties.argv.items

> `readonly` **items**: `object`

###### document.$defs.process.properties.argv.items.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.process.properties.env

> `readonly` **env**: `object`

###### document.$defs.process.properties.env.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.process.properties.env.additionalProperties

> `readonly` **additionalProperties**: `object`

###### document.$defs.process.properties.env.additionalProperties.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.process.properties.cwd

> `readonly` **cwd**: `object`

###### document.$defs.process.properties.cwd.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.process.properties.cwd.pattern

> `readonly` **pattern**: `"^/"` = `"^/"`

###### document.$defs.graph

> `readonly` **graph**: `object`

###### document.$defs.graph.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.graph.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.graph.required

> `readonly` **required**: readonly \[`"roots"`, `"objects"`\]

###### document.$defs.graph.properties

> `readonly` **properties**: `object`

###### document.$defs.graph.properties.roots

> `readonly` **roots**: `object`

###### document.$defs.graph.properties.roots.type

> `readonly` **type**: `"array"` = `"array"`

###### document.$defs.graph.properties.roots.items

> `readonly` **items**: `object`

###### document.$defs.graph.properties.roots.items.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.graph.properties.roots.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.graph.properties.roots.items.required

> `readonly` **required**: readonly \[`"name"`, `"value"`\]

###### document.$defs.graph.properties.roots.items.properties

> `readonly` **properties**: `object`

###### document.$defs.graph.properties.roots.items.properties.name

> `readonly` **name**: `object`

###### document.$defs.graph.properties.roots.items.properties.name.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.graph.properties.roots.items.properties.name.minLength

> `readonly` **minLength**: `1` = `1`

###### document.$defs.graph.properties.roots.items.properties.value

> `readonly` **value**: `object`

###### document.$defs.graph.properties.roots.items.properties.value.$ref

> `readonly` **$ref**: `"#/$defs/value"` = `"#/$defs/value"`

###### document.$defs.graph.properties.objects

> `readonly` **objects**: `object`

###### document.$defs.graph.properties.objects.type

> `readonly` **type**: `"array"` = `"array"`

###### document.$defs.graph.properties.objects.items

> `readonly` **items**: `object`

###### document.$defs.graph.properties.objects.items.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.graph.properties.objects.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.graph.properties.objects.items.required

> `readonly` **required**: readonly \[`"id"`, `"kind"`\]

###### document.$defs.graph.properties.objects.items.properties

> `readonly` **properties**: `object`

###### document.$defs.graph.properties.objects.items.properties.id

> `readonly` **id**: `object`

###### document.$defs.graph.properties.objects.items.properties.id.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.graph.properties.objects.items.properties.id.minLength

> `readonly` **minLength**: `1` = `1`

###### document.$defs.graph.properties.objects.items.properties.kind

> `readonly` **kind**: `object`

###### document.$defs.graph.properties.objects.items.properties.kind.enum

> `readonly` **enum**: readonly \[`"object"`, `"array"`, `"map"`, `"set"`, `"date"`, `"regexp"`, `"error"`, `"array-buffer"`, `"typed-array"`, `"opaque"`\] = `RUNTIME_ADAPTER_OBJECT_KINDS`

###### document.$defs.graph.properties.objects.items.properties.type

> `readonly` **type**: `object`

###### document.$defs.graph.properties.objects.items.properties.type.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.graph.properties.objects.items.properties.type.minLength

> `readonly` **minLength**: `1` = `1`

###### document.$defs.graph.properties.objects.items.properties.prototype

> `readonly` **prototype**: `object`

###### document.$defs.graph.properties.objects.items.properties.prototype.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.graph.properties.objects.items.properties.prototype.minLength

> `readonly` **minLength**: `1` = `1`

###### document.$defs.graph.properties.objects.items.properties.properties

> `readonly` **properties**: `object`

###### document.$defs.graph.properties.objects.items.properties.properties.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.graph.properties.objects.items.properties.properties.additionalProperties

> `readonly` **additionalProperties**: `object`

###### document.$defs.graph.properties.objects.items.properties.properties.additionalProperties.$ref

> `readonly` **$ref**: `"#/$defs/value"` = `"#/$defs/value"`

###### document.$defs.graph.properties.objects.items.properties.elements

> `readonly` **elements**: `object`

###### document.$defs.graph.properties.objects.items.properties.elements.type

> `readonly` **type**: `"array"` = `"array"`

###### document.$defs.graph.properties.objects.items.properties.elements.items

> `readonly` **items**: `object`

###### document.$defs.graph.properties.objects.items.properties.elements.items.$ref

> `readonly` **$ref**: `"#/$defs/value"` = `"#/$defs/value"`

###### document.$defs.graph.properties.objects.items.properties.entries

> `readonly` **entries**: `object`

###### document.$defs.graph.properties.objects.items.properties.entries.type

> `readonly` **type**: `"array"` = `"array"`

###### document.$defs.graph.properties.objects.items.properties.entries.items

> `readonly` **items**: `object`

###### document.$defs.graph.properties.objects.items.properties.entries.items.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.graph.properties.objects.items.properties.entries.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.graph.properties.objects.items.properties.entries.items.required

> `readonly` **required**: readonly \[..., ...\]

###### document.$defs.graph.properties.objects.items.properties.entries.items.properties

> `readonly` **properties**: `object`

###### document.$defs.graph.properties.objects.items.properties.entries.items.properties.key

> `readonly` **key**: ...

###### document.$defs.graph.properties.objects.items.properties.entries.items.properties.value

> `readonly` **value**: ...

###### document.$defs.graph.properties.objects.items.properties.byteLength

> `readonly` **byteLength**: `object`

###### document.$defs.graph.properties.objects.items.properties.byteLength.type

> `readonly` **type**: `"integer"` = `"integer"`

###### document.$defs.graph.properties.objects.items.properties.byteLength.minimum

> `readonly` **minimum**: `0` = `0`

###### document.$defs.graph.properties.objects.items.properties.refusal

> `readonly` **refusal**: [`RuntimeAdapterJsonSchema`](#runtimeadapterjsonschema) = `REFUSAL_SCHEMA`

###### document.$defs.graph.properties.identityAssertions

> `readonly` **identityAssertions**: `object`

###### document.$defs.graph.properties.identityAssertions.type

> `readonly` **type**: `"array"` = `"array"`

###### document.$defs.graph.properties.identityAssertions.items

> `readonly` **items**: `object`

###### document.$defs.graph.properties.identityAssertions.items.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.graph.properties.identityAssertions.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.graph.properties.identityAssertions.items.required

> `readonly` **required**: readonly \[`"left"`, `"right"`, `"same"`\]

###### document.$defs.graph.properties.identityAssertions.items.properties

> `readonly` **properties**: `object`

###### document.$defs.graph.properties.identityAssertions.items.properties.left

> `readonly` **left**: `object`

###### document.$defs.graph.properties.identityAssertions.items.properties.left.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.graph.properties.identityAssertions.items.properties.left.minLength

> `readonly` **minLength**: `1` = `1`

###### document.$defs.graph.properties.identityAssertions.items.properties.right

> `readonly` **right**: `object`

###### document.$defs.graph.properties.identityAssertions.items.properties.right.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.graph.properties.identityAssertions.items.properties.right.minLength

> `readonly` **minLength**: `1` = `1`

###### document.$defs.graph.properties.identityAssertions.items.properties.same

> `readonly` **same**: `object`

###### document.$defs.graph.properties.identityAssertions.items.properties.same.type

> `readonly` **type**: `"boolean"` = `"boolean"`

###### document.$defs.graph.properties.checksumHex

> `readonly` **checksumHex**: `object`

###### document.$defs.graph.properties.checksumHex.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.graph.properties.checksumHex.pattern

> `readonly` **pattern**: `"^0x[0-9A-Fa-f]+$"` = `"^0x[0-9A-Fa-f]+$"`

###### document.$defs.resources

> `readonly` **resources**: `object`

###### document.$defs.resources.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.resources.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.resources.required

> `readonly` **required**: readonly \[`"resources"`, `"unsupported"`\]

###### document.$defs.resources.properties

> `readonly` **properties**: `object`

###### document.$defs.resources.properties.resources

> `readonly` **resources**: `object`

###### document.$defs.resources.properties.resources.type

> `readonly` **type**: `"array"` = `"array"`

###### document.$defs.resources.properties.resources.items

> `readonly` **items**: `object`

###### document.$defs.resources.properties.resources.items.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.resources.properties.resources.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.resources.properties.resources.items.required

> `readonly` **required**: readonly \[`"id"`, `"kind"`, `"state"`\]

###### document.$defs.resources.properties.resources.items.properties

> `readonly` **properties**: `object`

###### document.$defs.resources.properties.resources.items.properties.id

> `readonly` **id**: `object`

###### document.$defs.resources.properties.resources.items.properties.id.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.resources.properties.resources.items.properties.id.minLength

> `readonly` **minLength**: `1` = `1`

###### document.$defs.resources.properties.resources.items.properties.kind

> `readonly` **kind**: `object`

###### document.$defs.resources.properties.resources.items.properties.kind.enum

> `readonly` **enum**: readonly \[`"argv"`, `"env"`, `"cwd"`, `"fd"`, `"file"`, `"socket"`, `"timer"`, `"signal"`, `"child-process"`, `"worker"`, `"pty"`, `"fs-watch"`, `"native-handle"`, `"unknown"`\] = `RUNTIME_ADAPTER_RESOURCE_KINDS`

###### document.$defs.resources.properties.resources.items.properties.state

> `readonly` **state**: `object`

###### document.$defs.resources.properties.resources.items.properties.state.enum

> `readonly` **enum**: readonly \[`"captured"`, `"refused"`, `"unsupported"`\] = `RUNTIME_ADAPTER_RESOURCE_STATES`

###### document.$defs.resources.properties.resources.items.properties.recipe

> `readonly` **recipe**: `object`

###### document.$defs.resources.properties.resources.items.properties.recipe.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.resources.properties.resources.items.properties.refusal

> `readonly` **refusal**: [`RuntimeAdapterJsonSchema`](#runtimeadapterjsonschema) = `REFUSAL_SCHEMA`

###### document.$defs.resources.properties.unsupported

> `readonly` **unsupported**: [`RuntimeAdapterJsonSchema`](#runtimeadapterjsonschema) = `UNSUPPORTED_SCHEMA`

###### document.$defs.restore

> `readonly` **restore**: `object`

###### document.$defs.restore.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.restore.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.restore.required

> `readonly` **required**: readonly \[`"semanticStateSupported"`, `"liveProcessSupported"`, `"requiredMetadata"`\]

###### document.$defs.restore.properties

> `readonly` **properties**: `object`

###### document.$defs.restore.properties.semanticStateSupported

> `readonly` **semanticStateSupported**: `object`

###### document.$defs.restore.properties.semanticStateSupported.type

> `readonly` **type**: `"boolean"` = `"boolean"`

###### document.$defs.restore.properties.liveProcessSupported

> `readonly` **liveProcessSupported**: `object`

###### document.$defs.restore.properties.liveProcessSupported.type

> `readonly` **type**: `"boolean"` = `"boolean"`

###### document.$defs.restore.properties.requiredMetadata

> `readonly` **requiredMetadata**: `object`

###### document.$defs.restore.properties.requiredMetadata.type

> `readonly` **type**: `"array"` = `"array"`

###### document.$defs.restore.properties.requiredMetadata.items

> `readonly` **items**: `object`

###### document.$defs.restore.properties.requiredMetadata.items.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.restore.properties.requiredMetadata.items.minLength

> `readonly` **minLength**: `1` = `1`

###### document.$defs.restore.properties.refusal

> `readonly` **refusal**: [`RuntimeAdapterJsonSchema`](#runtimeadapterjsonschema) = `REFUSAL_SCHEMA`

###### document.$defs.bundleMapping

> `readonly` **bundleMapping**: `object`

###### document.$defs.bundleMapping.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.bundleMapping.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.bundleMapping.required

> `readonly` **required**: readonly \[`"manifestFeatures"`, `"sidecarFiles"`, `"objects"`, `"resources"`\]

###### document.$defs.bundleMapping.properties

> `readonly` **properties**: `object`

###### document.$defs.bundleMapping.properties.manifestFeatures

> `readonly` **manifestFeatures**: `object`

###### document.$defs.bundleMapping.properties.manifestFeatures.type

> `readonly` **type**: `"array"` = `"array"`

###### document.$defs.bundleMapping.properties.manifestFeatures.items

> `readonly` **items**: `object`

###### document.$defs.bundleMapping.properties.manifestFeatures.items.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.bundleMapping.properties.manifestFeatures.items.minLength

> `readonly` **minLength**: `1` = `1`

###### document.$defs.bundleMapping.properties.manifestFeatures.uniqueItems

> `readonly` **uniqueItems**: `true` = `true`

###### document.$defs.bundleMapping.properties.sidecarFiles

> `readonly` **sidecarFiles**: `object`

###### document.$defs.bundleMapping.properties.sidecarFiles.type

> `readonly` **type**: `"array"` = `"array"`

###### document.$defs.bundleMapping.properties.sidecarFiles.items

> `readonly` **items**: `object`

###### document.$defs.bundleMapping.properties.sidecarFiles.items.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.bundleMapping.properties.sidecarFiles.items.minLength

> `readonly` **minLength**: `1` = `1`

###### document.$defs.bundleMapping.properties.sidecarFiles.uniqueItems

> `readonly` **uniqueItems**: `true` = `true`

###### document.$defs.bundleMapping.properties.objects

> `readonly` **objects**: `object`

###### document.$defs.bundleMapping.properties.objects.type

> `readonly` **type**: `"array"` = `"array"`

###### document.$defs.bundleMapping.properties.objects.items

> `readonly` **items**: `object`

###### document.$defs.bundleMapping.properties.objects.items.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.bundleMapping.properties.objects.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.bundleMapping.properties.objects.items.required

> `readonly` **required**: readonly \[`"portableObjectId"`, `"role"`\]

###### document.$defs.bundleMapping.properties.objects.items.properties

> `readonly` **properties**: `object`

###### document.$defs.bundleMapping.properties.objects.items.properties.portableObjectId

> `readonly` **portableObjectId**: `object`

###### document.$defs.bundleMapping.properties.objects.items.properties.portableObjectId.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.bundleMapping.properties.objects.items.properties.portableObjectId.minLength

> `readonly` **minLength**: `1` = `1`

###### document.$defs.bundleMapping.properties.objects.items.properties.role

> `readonly` **role**: `object`

###### document.$defs.bundleMapping.properties.objects.items.properties.role.enum

> `readonly` **enum**: readonly \[`"runtime-roots"`, `"runtime-object-graph"`, `"runtime-resources"`, `"runtime-metadata"`\] = `RUNTIME_ADAPTER_MAPPING_ROLES`

###### document.$defs.bundleMapping.properties.objects.items.properties.graphObjectIds

> `readonly` **graphObjectIds**: `object`

###### document.$defs.bundleMapping.properties.objects.items.properties.graphObjectIds.type

> `readonly` **type**: `"array"` = `"array"`

###### document.$defs.bundleMapping.properties.objects.items.properties.graphObjectIds.items

> `readonly` **items**: `object`

###### document.$defs.bundleMapping.properties.objects.items.properties.graphObjectIds.items.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.bundleMapping.properties.objects.items.properties.graphObjectIds.items.minLength

> `readonly` **minLength**: `1` = `1`

###### document.$defs.bundleMapping.properties.objects.items.properties.graphObjectIds.uniqueItems

> `readonly` **uniqueItems**: `true` = `true`

###### document.$defs.bundleMapping.properties.resources

> `readonly` **resources**: `object`

###### document.$defs.bundleMapping.properties.resources.type

> `readonly` **type**: `"array"` = `"array"`

###### document.$defs.bundleMapping.properties.resources.items

> `readonly` **items**: `object`

###### document.$defs.bundleMapping.properties.resources.items.type

> `readonly` **type**: `"object"` = `"object"`

###### document.$defs.bundleMapping.properties.resources.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### document.$defs.bundleMapping.properties.resources.items.required

> `readonly` **required**: readonly \[`"portableResourceId"`, `"runtimeResourceId"`\]

###### document.$defs.bundleMapping.properties.resources.items.properties

> `readonly` **properties**: `object`

###### document.$defs.bundleMapping.properties.resources.items.properties.portableResourceId

> `readonly` **portableResourceId**: `object`

###### document.$defs.bundleMapping.properties.resources.items.properties.portableResourceId.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.bundleMapping.properties.resources.items.properties.portableResourceId.minLength

> `readonly` **minLength**: `1` = `1`

###### document.$defs.bundleMapping.properties.resources.items.properties.runtimeResourceId

> `readonly` **runtimeResourceId**: `object`

###### document.$defs.bundleMapping.properties.resources.items.properties.runtimeResourceId.type

> `readonly` **type**: `"string"` = `"string"`

###### document.$defs.bundleMapping.properties.resources.items.properties.runtimeResourceId.minLength

> `readonly` **minLength**: `1` = `1`

***

### VsockSecrets

> `const` **VsockSecrets**: `object`

#### Type Declaration

##### send()

> `readonly` **send**(`udsPath`, `secrets`, `opts?`): `Promise`\<`void`\>

Open the UDS the vsock bridge is listening on, push every
KEY=VALUE entry, close. Resolves once the write + close drain.

Values must be single-line (no newlines). Keys must be valid
shell identifiers (letters/digits/underscore, no leading digit);
the guest agent skips entries that don't match.

###### Parameters

###### udsPath

`string`

###### secrets

`Record`\<`string`, `string`\>

###### opts?

[`VsockSecretsOptions`](#vsocksecretsoptions) = `{}`

###### Returns

`Promise`\<`void`\>

***

### \_internal

> `const` **\_internal**: `object`

#### Type Declaration

##### collect

> **collect**: (`stream`, `capBytes`) => `Promise`\<`string`\> = `_collect`

###### Parameters

###### stream

`Readable`

###### capBytes?

`number` = `CONSOLE_TAIL_BYTES`

###### Returns

`Promise`\<`string`\>

##### CONSOLE\_TAIL\_BYTES

> **CONSOLE\_TAIL\_BYTES**: `number` = `_CONSOLE_TAIL_BYTES`

##### validateMemoryMib

> **validateMemoryMib**: (`mib`) => `number` = `_validateMemoryMib`

###### Parameters

###### mib

`number`

###### Returns

`number`

## Functions

### readBalloonStats()

> **readBalloonStats**(`path`): [`BalloonCounters`](#ballooncounters)

Read the balloon-stats file at `path`. Returns `null` when:
  - the file is missing (VMM was launched without
    `MACHINEN_STATS_FILE`, or the path is stale),
  - it's shorter than `STATS_FILE_SIZE` (truncated mid-write — not
    possible with the mmap'd writer, but defensive against an
    out-of-band actor),
  - it's unreadable (permissions, gone between stat and read).

#### Parameters

##### path

`string`

#### Returns

[`BalloonCounters`](#ballooncounters)

***

### probeBunRuntimeAdapter()

> **probeBunRuntimeAdapter**(`options?`): [`BunRuntimeAdapterProbe`](#bunruntimeadapterprobe)

#### Parameters

##### options?

[`ProbeBunRuntimeAdapterOptions`](#probebunruntimeadapteroptions) = `{}`

#### Returns

[`BunRuntimeAdapterProbe`](#bunruntimeadapterprobe)

***

### inspectBunPackagedExecutable()

> **inspectBunPackagedExecutable**(`path`): \{ `accepted`: `true`; `identity`: [`BunPackagedExecutableIdentity`](#bunpackagedexecutableidentity); \} \| \{ `accepted`: `false`; `refusal`: [`RuntimeAdapterRefusal`](#runtimeadapterrefusal); \}

#### Parameters

##### path

`string`

#### Returns

\{ `accepted`: `true`; `identity`: [`BunPackagedExecutableIdentity`](#bunpackagedexecutableidentity); \} \| \{ `accepted`: `false`; `refusal`: [`RuntimeAdapterRefusal`](#runtimeadapterrefusal); \}

***

### detachedLogRoot()

> **detachedLogRoot**(): `string`

Default directory for `<pid>.boot.log` snapshots. Honors
`MACHINEN_DETACHED_LOG_DIR` so tests can scope writes to a tmpdir
without scribbling under `$HOME`.

#### Returns

`string`

***

### bootSnapshotPath()

> **bootSnapshotPath**(`pid`): `string`

Path the next snapshot for `pid` will be written to.

#### Parameters

##### pid

`number`

#### Returns

`string`

***

### writeBootSnapshot()

> **writeBootSnapshot**(`path`, `contents`): `boolean`

Atomically write the captured boot console to `path`. Best-effort:
a failure here must not block the detach — the VMM is already
running and the boot succeeded, so a missing snapshot is a
diagnostic loss, not a correctness issue. Returns `true` on
success, `false` if the write was skipped or failed.

#### Parameters

##### path

`string`

##### contents

`string`

#### Returns

`boolean`

***

### isMachinenError()

> **isMachinenError**(`err`, `code?`): `err is MachinenError`

Narrowing type guard. Pass a specific `code` to check both identity
and discriminant in one call.

#### Parameters

##### err

`unknown`

##### code?

[`ErrorCode`](#errorcode-1)

#### Returns

`err is MachinenError`

***

### formatMachinenError()

> **formatMachinenError**(`err`): `string`

Format a MachinenError for CLI stderr. Shows the code inline and walks
the `cause` chain. Used by the CLI's unified `handleError`; exported so
library callers can adopt the same format if they want to.

#### Parameters

##### err

[`MachinenError`](#machinenerror)

#### Returns

`string`

***

### runGc()

> **runGc**(`opts?`): [`GcResult`](#gcresult)[]

Walk the registry; for each entry that's dead or pid-recycled,
remove its cleanupPaths + bootLog + registry entry. Returns one
result per entry processed (live entries are skipped silently).

#### Parameters

##### opts?

[`RunGcOptions`](#rungcoptions) = `{}`

#### Returns

[`GcResult`](#gcresult)[]

***

### readHostFreeBytes()

> **readHostFreeBytes**(): `Promise`\<`number`\>

Bytes of memory the OS reports as available right now. "Available"
is the loose union the kernel exposes:
  - Linux  → /proc/meminfo MemAvailable (post-3.14 kernels — every
             distro machinen runs on). MemAvailable already accounts
             for reclaimable slab + page-cache, so it's the right
             answer for "could a new process allocate X bytes
             without paging or OOM?".
  - Darwin → vm_stat free + speculative + purgeable. Inactive is
             excluded because it's dirty and needs a pageout, which
             wouldn't help a fork that needs RAM right now.
  - other  → totalmem(). Soft-fail rather than block fork on a
             platform we can't measure.

#### Returns

`Promise`\<`number`\>

***

### readHostTotalBytes()

> **readHostTotalBytes**(): `number`

Total physical memory in bytes. Thin wrapper over `os.totalmem()`
exported alongside the free reader so tests and the backpressure
check pull both numbers from the same module.

#### Returns

`number`

***

### checkForkBackpressure()

> **checkForkBackpressure**(`opts`): `Promise`\<`void`\>

Refuse a fork when the host is under memory pressure. Throws
`BootError("FORK_MEMORY_BACKPRESSURE")` when free < total *
threshold, modeled on the throw-immediately shape of #267's
`BOOT_PORT_FORWARD_IN_USE` gate. Caller is responsible for any
retry policy.

#### Parameters

##### opts

[`CheckForkBackpressureOptions`](#checkforkbackpressureoptions)

#### Returns

`Promise`\<`void`\>

***

### captureJsBuildIdentity()

> **captureJsBuildIdentity**(`options`): [`JsBuildIdentitySidecar`](#jsbuildidentitysidecar)

#### Parameters

##### options

[`CaptureJsBuildIdentityOptions`](#capturejsbuildidentityoptions)

#### Returns

[`JsBuildIdentitySidecar`](#jsbuildidentitysidecar)

***

### verifyJsBuildIdentity()

> **verifyJsBuildIdentity**(`expected`, `options`): [`JsBuildIdentityVerification`](#jsbuildidentityverification)

#### Parameters

##### expected

[`JsBuildIdentitySidecar`](#jsbuildidentitysidecar)

##### options

[`CaptureJsBuildIdentityOptions`](#capturejsbuildidentityoptions)

#### Returns

[`JsBuildIdentityVerification`](#jsbuildidentityverification)

***

### mkinitramfsBundle()

> **mkinitramfsBundle**(`opts`): `void`

#### Parameters

##### opts

[`PackBundleOptions`](#packbundleoptions)

#### Returns

`void`

***

### mkinitramfsTinyBundle()

> **mkinitramfsTinyBundle**(`opts`): `void`

Build the tiny initramfs used by every user-facing boot() (#119).

Layout:
  /init                            compiled Zig init
  /machinen-config.json            cmd/env/cwd/liveMounts for /init
  /etc/machinen-boot-epoch         wall clock seed for the guest
  /etc/machinen-mountdisk-guest    optional, target dir for the
                                   `--mount` overlay (#272). The
                                   actual payload rides on virtio-
                                   blk slots 5+6, not in the cpio.
  /dev/console                     char node 5,1 — kernel needs it
                                   before /init re-opens the console
  /tmp                             sticky 1777

No /lib/modules tree, no kmod, no /modules/*.ko, no Debian userland.
The custom kernel ships with virtio_*, ext4, vsock, squashfs, and
overlayfs built in (scripts/build-kernel-arm64.sh), so /init pivots
straight into /dev/vda without a finit_module pass.

#### Parameters

##### opts

[`PackTinyBundleOptions`](#packtinybundleoptions)

#### Returns

`void`

***

### mkinitramfsRootfs()

> **mkinitramfsRootfs**(`opts`): `void`

#### Parameters

##### opts

[`PackRootfsOptions`](#packrootfsoptions)

#### Returns

`void`

***

### mkinitramfsMinimal()

> **mkinitramfsMinimal**(`opts`): `void`

#### Parameters

##### opts

[`PackMinimalOptions`](#packminimaloptions)

#### Returns

`void`

***

### mkinitramfsWorkspace()

> **mkinitramfsWorkspace**(`opts`): `void`

#### Parameters

##### opts

[`PackWorkspaceOptions`](#packworkspaceoptions)

#### Returns

`void`

***

### mkinitramfsCli()

> **mkinitramfsCli**(`argv`): `void`

Invoked by the CLI shim at packages/microvm/test-fixtures/assets/mkinitramfs.ts.
Kept argv-compatible with the old Python script so shell fixtures
(smoke.sh, try.sh, handoff.sh) don't need deeper changes.

#### Parameters

##### argv

`string`[]

#### Returns

`void`

***

### mountdiskImgCacheDir()

> **mountdiskImgCacheDir**(): `string`

Default cache root: `~/.cache/machinen/mountdisk`.

#### Returns

`string`

***

### markMountDiskImageClean()

> **markMountDiskImageClean**(`imgPath`): `void`

Mark a cached squashfs lower as "cleanly released," same idiom as
`markRootfsImageClean()`. The lower is read-only inside the guest
so corruption is unlikely, but a host crash mid-write during the
initial mksquashfs would leave a truncated file in the cache.

No-op when the image doesn't exist. Failures are swallowed.

#### Parameters

##### imgPath

`string`

#### Returns

`void`

***

### ensureMountDiskImage()

> **ensureMountDiskImage**(`hostAbs`, `opts?`): [`EnsureMountDiskImageResult`](#ensuremountdiskimageresult)

Resolve `hostAbs` to a content-addressed squashfs lower image,
materializing it on first call. Returns the absolute path to the
cached `.sqfs`.

Cache key: sha256 of a sorted manifest covering relpath, mode,
size, mtime_ns, and either the symlink target or the per-file
sha256. Same input tree → same image, even across runs and
processes. Concurrent callers don't race because we materialize
into a uniquely-named staging directory and atomically rename.

Lifecycle (mirrors rootfs-img.ts): the returned path is in the
"in-use" state (no `.ok` marker on disk). The caller invokes
`markMountDiskImageClean(path)` once they're done.

#### Parameters

##### hostAbs

`string`

##### opts?

[`EnsureMountDiskImageOptions`](#ensuremountdiskimageoptions) = `{}`

#### Returns

[`EnsureMountDiskImageResult`](#ensuremountdiskimageresult)

#### Throws

BOOT_MOUNTDISK_TOOL_MISSING when no mksquashfs
  binary is found |
  {ProvisionError} PROVISION_INSTALL_HOOK_FAILED when mksquashfs
  exits non-zero |
  {BootError} BOOT_MOUNT_HOST_NOT_FOUND when the source dir is
  missing |
  {BootError} BOOT_MOUNT_INVALID when the source dir isn't a
  directory.

***

### ensureMountDiskUpper()

> **ensureMountDiskUpper**(`opts?`): [`EnsureMountDiskUpperResult`](#ensuremountdiskupperresult)

Materialize a per-VM ext4 RW upper image for the mount overlay.
Each call returns a fresh sparse file in `tmpdir()` — the upper is
specific to one VM and gets cleaned up alongside the per-boot
rootdisk reflink. Snapshots reflink the upper into the bundle so
writes survive snapshot/restore.

Mirrors rootfs-img.ts's mke2fs lookup for the file-format step;
shares the same `BOOT_MOUNTDISK_TOOL_MISSING` failure mode if
mke2fs is unavailable (the runtime needs e2fsprogs anyway for the
rootdisk path, so this is rarely the failure that fires first).

#### Parameters

##### opts?

[`EnsureMountDiskUpperOptions`](#ensuremountdiskupperoptions) = `{}`

#### Returns

[`EnsureMountDiskUpperResult`](#ensuremountdiskupperresult)

#### Throws

BOOT_MOUNTDISK_TOOL_MISSING when no mke2fs is
  available |
  {ProvisionError} PROVISION_INSTALL_HOOK_FAILED when mke2fs fails.

***

### resolveMksquashfs()

> **resolveMksquashfs**(): `string`

Resolve the mksquashfs binary path using the same lookup order as
`ensureMountDiskImage` itself: env override → bundled package →
PATH → Homebrew opt prefix. Returns `undefined` when no binary is
available.

#### Returns

`string`

***

### captureNodeAsyncContinuations()

> **captureNodeAsyncContinuations**(`inputs`): [`NodeAsyncContinuationState`](#nodeasynccontinuationstate)

#### Parameters

##### inputs

[`NodeAsyncContinuationInput`](#nodeasynccontinuationinput)[]

#### Returns

[`NodeAsyncContinuationState`](#nodeasynccontinuationstate)

***

### restoreNodeAsyncContinuations()

> **restoreNodeAsyncContinuations**(`state`, `handlers`): `Promise`\<[`RestoredNodeAsyncContinuation`](#restorednodeasynccontinuation)[]\>

#### Parameters

##### state

[`NodeAsyncContinuationState`](#nodeasynccontinuationstate)

##### handlers

[`NodeAsyncContinuationHandlers`](#nodeasynccontinuationhandlers)

#### Returns

`Promise`\<[`RestoredNodeAsyncContinuation`](#restorednodeasynccontinuation)[]\>

***

### captureNodeRuntimeAdapterDocument()

> **captureNodeRuntimeAdapterDocument**(`roots`, `options?`): [`RuntimeAdapterDocument`](#runtimeadapterdocument)

#### Parameters

##### roots

`Record`\<`string`, `unknown`\>

##### options?

[`CaptureNodeRuntimeAdapterOptions`](#capturenoderuntimeadapteroptions) = `{}`

#### Returns

[`RuntimeAdapterDocument`](#runtimeadapterdocument)

***

### captureNodeNativeResources()

> **captureNodeNativeResources**(`options?`): [`RuntimeAdapterResources`](#runtimeadapterresources)

#### Parameters

##### options?

[`CaptureNodeNativeResourcesOptions`](#capturenodenativeresourcesoptions) = `{}`

#### Returns

[`RuntimeAdapterResources`](#runtimeadapterresources)

***

### restoreNodeCapturedResourceRecipes()

> **restoreNodeCapturedResourceRecipes**(`resources`): [`RestoredNodeResourceRecipes`](#restorednoderesourcerecipes)

#### Parameters

##### resources

[`RuntimeAdapterResources`](#runtimeadapterresources)

#### Returns

[`RestoredNodeResourceRecipes`](#restorednoderesourcerecipes)

***

### restoreNodeRuntimeAdapterRoots()

> **restoreNodeRuntimeAdapterRoots**(`document`): `Record`\<`string`, `unknown`\>

#### Parameters

##### document

[`RuntimeAdapterDocument`](#runtimeadapterdocument)

#### Returns

`Record`\<`string`, `unknown`\>

***

### collectNodeRuntimeAdapterRefusals()

> **collectNodeRuntimeAdapterRefusals**(`document`): [`RuntimeAdapterRefusal`](#runtimeadapterrefusal)[]

#### Parameters

##### document

[`RuntimeAdapterDocument`](#runtimeadapterdocument)

#### Returns

[`RuntimeAdapterRefusal`](#runtimeadapterrefusal)[]

***

### validatePid()

> **validatePid**(`pid`, `expected`): [`PidStatus`](#pidstatus)

Return whether the running process at `pid` is still our VMM.

- `alive`     — pid is alive AND the exe + start-time match.
- `dead`      — kill(pid, 0) failed (gone or permission-denied,
                either way unreachable).
- `recycled`  — pid is alive but the process isn't ours (different
                exe, or start time outside skew).

Falls back to `alive` when the recorded entry lacks `vmmExe` /
`startedAt` (older entries from before PR2). Conservative on
purpose: the gc decision then leans on `kill(pid, 0)` alone, same
behaviour we had before.

#### Parameters

##### pid

`number`

##### expected

###### vmmExe?

`string`

###### startedAt?

`number`

#### Returns

[`PidStatus`](#pidstatus)

***

### readHostRssBytes()

> **readHostRssBytes**(`pid`, `statsPath?`): `number`

RSS bytes for one pid, or null if not readable.

#### Parameters

##### pid

`number`

##### statsPath?

`string`

#### Returns

`number`

***

### readHostRssBytesMulti()

> **readHostRssBytesMulti**(`targets`): `Map`\<`number`, `number`\>

Bulk variant for `machinen ls`: one syscall (Linux) or one
subprocess (Darwin) for every live VM, instead of N. Pids that
can't be read are simply absent from the result map — caller
decides whether to render "?" or skip the row.

#### Parameters

##### targets

readonly (`number` \| [`RssTarget`](#rsstarget))[]

#### Returns

`Map`\<`number`, `number`\>

***

### resolveBaseRootfs()

> **resolveBaseRootfs**(`explicit?`, `cwd?`): `string`

Resolve the path to the base rootfs tarball, in the same order
`provision()` itself does:

  1. `explicit` — the caller-supplied path (resolved against `cwd`).
  2. `MACHINEN_ASSETS_DIR` env var — points at a directory laid out like
     `scripts/build-base-assets.sh`'s output (contains the selected
     arch's rootfs tarball). Same convention `@machinen/cli` honors for
     local/dev builds.
  3. `@machinen/cli`'s on-disk cache at
     `~/.machinen/@machinen/runtime@<version>/bases/debian-<arch>/rootfs.tar.gz`.
     Populated by running `machinen` once against the installed runtime.

Throws `ProvisionError` with guidance if none of those turn up a file.
Exported so callers can pre-check or build their own tooling on it.

#### Parameters

##### explicit?

`string`

##### cwd?

`string` = `...`

#### Returns

`string`

#### Throws

PROVISION_BASE_NOT_FOUND | PROVISION_ASSETS_DIR_INVALID

***

### resolveBaseKernel()

> **resolveBaseKernel**(`explicit?`, `cwd?`): `string`

Resolve the path to the guest kernel image. Same fallback chain as
`resolveBaseRootfs`: explicit → `MACHINEN_ASSETS_DIR/<arch kernel>` →
`@machinen/cli` cache at `<base>/Image`. Exported for callers that
want to pre-check or wire the path into `boot()`.

#### Parameters

##### explicit?

`string`

##### cwd?

`string` = `...`

#### Returns

`string`

#### Throws

PROVISION_KERNEL_NOT_FOUND |
  PROVISION_ASSETS_DIR_INVALID

***

### resolveBaseDtb()

> **resolveBaseDtb**(`explicit?`, `cwd?`): `string`

Resolve the path to the guest DTB. amd64 guests do not use a DTB unless
the caller passes one explicitly. arm64 follows the same fallback chain as
`resolveBaseRootfs`: explicit → `MACHINEN_ASSETS_DIR/virt-arm64.dtb` →
`@machinen/cli` cache at `<base>/virt.dtb`.

#### Parameters

##### explicit?

`string`

##### cwd?

`string` = `...`

#### Returns

`string`

#### Throws

PROVISION_DTB_NOT_FOUND |
  PROVISION_ASSETS_DIR_INVALID

***

### provision()

> **provision**(`opts`): `Promise`\<[`ProvisionResult`](#provisionresult)\>

Boot the base rootfs, run the user install hook, and freeze the
resulting filesystem state to a new tarball at `opts.out`.

#### Parameters

##### opts

[`ProvisionOptions`](#provisionoptions)

#### Returns

`Promise`\<[`ProvisionResult`](#provisionresult)\>

#### Throws

PROVISION_BASE_NOT_FOUND |
  PROVISION_KERNEL_NOT_FOUND | PROVISION_DTB_NOT_FOUND |
  PROVISION_ASSETS_DIR_INVALID | PROVISION_INSTALL_HOOK_FAILED |
  PROVISION_DISK_TOO_SMALL

#### Throws

see `boot()` — propagated from the inner boot

***

### bootPty()

> **bootPty**(`opts`): [`PtyVmHandle`](#ptyvmhandle)

Fork `binary` under a new pty pair. The returned handle is wire-
compatible with `VmHandle` from index.ts so the existing Sandboxes
registry can hold it.

#### Parameters

##### opts

[`PtyBootOptions`](#ptybootoptions)

#### Returns

[`PtyVmHandle`](#ptyvmhandle)

***

### registryRoot()

> **registryRoot**(): `string`

Absolute path to the registry root. Honors `MACHINEN_REGISTRY_DIR`
so tests can point at a scratch dir without stomping on real entries.

#### Returns

`string`

***

### list()

> **list**(): [`RegistryEntry`](#registryentry)[]

List all registry entries whose pid is still alive. Prunes stale
entries (pid no longer alive) and orphaned name pins as a side
effect, so a crashed VMM doesn't leave a stuck record behind.

#### Returns

[`RegistryEntry`](#registryentry)[]

***

### rootfsImgCacheDir()

> **rootfsImgCacheDir**(): `string`

Default cache root: `~/.cache/machinen/rootfs`.

#### Returns

`string`

***

### markRootfsImageClean()

> **markRootfsImageClean**(`imgPath`): `void`

Mark a cached rootfs image as "cleanly released" by writing the
sentinel that `ensureRootfsImage()` looks for on the next boot.
Called by the runtime after a VMM child exits without a signal —
an exit-code-only termination means the kernel had time to flush
and dismount the ext4 fs, so reusing the file is safe.

No-op if the image doesn't exist (e.g. the runtime never
materialized one). Failures are swallowed: a missing marker just
means the next boot rebuilds from the tarball, which is wasteful
but never wrong.

#### Parameters

##### imgPath

`string`

#### Returns

`void`

***

### ensureRootfsImage()

> **ensureRootfsImage**(`tarPath`, `opts?`): `string`

Resolve `tarPath` to a cached ext4 `.img`, materializing it on first
call. Returns the absolute path to the cached image.

Cache key: sha256 of the tarball. Same tarball → same image, even
across runs and processes. Concurrent callers do not race because
we materialize into a uniquely-named staging directory and atomically
rename into place — at worst two callers do redundant work; the
loser of the rename race re-checks and uses the winner's image.

Lifecycle (#170): the returned path is handed back in the "in-use"
state (no `.ok` marker on disk). The caller is expected to invoke
`markRootfsImageClean(path)` once they're done — `boot()` does this
from its child-exit handler when the VMM exits without a signal,
`provision()` does it after cloning the image read-only. If the
marker is never recreated (caller crashed mid-write or simply
forgot), the next `ensureRootfsImage()` for the same tarball
treats the image as poisoned and rebuilds it.

#### Parameters

##### tarPath

`string`

##### opts?

[`EnsureRootfsImageOptions`](#ensurerootfsimageoptions) = `{}`

#### Returns

`string`

#### Throws

ROOTFS_IMG_TOOL_MISSING (no e2fsprogs found)
  | PROVISION_BASE_NOT_FOUND (tarball missing) |
  PROVISION_INSTALL_HOOK_FAILED (tar / mke2fs failed)

***

### resolveMke2fs()

> **resolveMke2fs**(): `string`

Resolve the mke2fs binary path using the same lookup order as
`ensureRootfsImage` itself: env override → bundled package → PATH →
Homebrew keg-only. Returns `undefined` when no binary is available
(callers should treat this as "skip the optimization", not an error).

Exported so other tools that need to run mke2fs (e.g. `mountdisk-img`)
resolve the binary through the same lookup chain.

#### Returns

`string`

***

### validateRuntimeAdapterDocument()

> **validateRuntimeAdapterDocument**(`document`): `string`[]

#### Parameters

##### document

`unknown`

#### Returns

`string`[]

***

### assertRuntimeAdapterDocument()

> **assertRuntimeAdapterDocument**(`document`): [`RuntimeAdapterDocument`](#runtimeadapterdocument)

#### Parameters

##### document

`unknown`

#### Returns

[`RuntimeAdapterDocument`](#runtimeadapterdocument)

***

### attach()

> **attach**(`opts`): `Promise`\<[`VmHandle`](#vmhandle)\>

Reconnect to a running VM registered by an earlier `boot()` call
(possibly from a different process). Returns a `VmHandle` that can
`exec()`, `snapshot()`, and `kill()` the remote VM via the vsock
bridge the booter left behind.

Attached handles have inert stream properties (`stdin`/`stdout`/
`stderr` are empty `PassThrough`s) — those belong to the original
booter. `output()`/`errorOutput()` resolve with the empty string.
`wait()` polls the pid rather than listening for `exit`.

#### Parameters

##### opts

[`AttachOptions`](#attachoptions)

#### Returns

`Promise`\<[`VmHandle`](#vmhandle)\>

#### Throws

REGISTRY_VM_NOT_FOUND

***

### boot()

> **boot**(`opts?`): `Promise`\<[`VmHandle`](#vmhandle)\>

Boot a microVM and return a handle to interact with it.

#### Parameters

##### opts?

[`BootOptions`](#bootoptions) = `{}`

#### Returns

`Promise`\<[`VmHandle`](#vmhandle)\>

#### Throws

BOOT_VMM_MISSING | BOOT_VMM_PACKAGE_BROKEN |
  BOOT_IMAGE_NOT_FOUND | BOOT_SNAPSHOT_NOT_FOUND |
  BOOT_KERNEL_NOT_FOUND | BOOT_DTB_NOT_FOUND |
  BOOT_CMD_WITHOUT_IMAGE | BOOT_CMD_MISSING |
  BOOT_MOUNT_INVALID | BOOT_MOUNT_HOST_NOT_FOUND |
  BOOT_PORT_FORWARD_INVALID | BOOT_PORT_FORWARD_CONFLICT |
  BOOT_PORT_FORWARD_NO_GVPROXY | BOOT_PORT_FORWARD_IN_USE |
  BOOT_PACK_FAILED

***

### measureFirstByte()

> **measureFirstByte**(`vm`): `Promise`\<`number`\>

Time-to-first-output-byte for a boot. Useful for measuring how
much the snapshot path is (or isn't) buying us.

#### Parameters

##### vm

[`VmHandle`](#vmhandle)

#### Returns

`Promise`\<`number`\>

***

### autoSizeMemoryMib()

> **autoSizeMemoryMib**(`hostBytes?`): `number`

#### Parameters

##### hostBytes?

`number` = `...`

#### Returns

`number`

***

### resolveVmmBinary()

> **resolveVmmBinary**(): `string`

Locate the VMM binary using the same lookup order as `@machinen/cli`:
  1. `MACHINEN_VMM` env var (dev-mode override)
  2. `require.resolve("@machinen/native-<arch>-<os>")` → `binary` export

`@machinen/native-{arm64-darwin,arm64-linux,x64-linux}` is the
consolidated host-tool package — it carries the VMM, gvproxy,
guest ELFs, mke2fs, and mksquashfs. Callers can pass an explicit
`binary` to `boot()` to bypass this.

#### Returns

`string`

#### Throws

BOOT_VMM_MISSING | BOOT_VMM_PACKAGE_BROKEN

***

### buildWriteFileCmd()

> **buildWriteFileCmd**(`guestPath`, `contents`, `opts?`): `string`

Build the shell pipeline that `vm.writeFile()` ships through the
exec-agent. Stays single-line so it works against the legacy EXEC
opcode too (no need for the EXEC2 multi-line frame, which only newer
agents understand).

Encoding: contents go over the wire as base64 inside an `echo … |
base64 -d` pipe, so any byte sequence (binary, newlines, quotes) is
safe. `mkdir -p` runs first when `recursive` (the default).

Returns a single cmd string. For payloads that would exceed Linux's
`MAX_ARG_STRLEN` (128 KB per argv element) once shell-wrapped, use
`buildWriteFileCmds` instead — `vm.writeFile()` does.

#### Parameters

##### guestPath

`string`

##### contents

`string` \| `Buffer`\<`ArrayBufferLike`\>

##### opts?

[`WriteFileOptions`](#writefileoptions) = `{}`

#### Returns

`string`

***

### buildWriteFileCmds()

> **buildWriteFileCmds**(`guestPath`, `contents`, `opts?`): `string`[]

Plan the cmd sequence `vm.writeFile()` issues for `contents`.
Small payloads (base64 ≤ `WRITE_FILE_B64_CHUNK_BYTES`) collapse to a
single cmd identical to `buildWriteFileCmd`'s output. Larger payloads
stage the base64 to /tmp in append-chunks and then decode once at the
end, so no individual cmd line approaches `MAX_ARG_STRLEN`.

#### Parameters

##### guestPath

`string`

##### contents

`string` \| `Buffer`\<`ArrayBufferLike`\>

##### opts?

[`WriteFileOptions`](#writefileoptions) = `{}`

#### Returns

`string`[]

***

### warmImageConfigCache()

> **warmImageConfigCache**(`imagePath`, `config`): `void`

Pre-populate the image-config cache for a freshly-written tarball.
Lets `provision()` (and other tarball producers) skip the slow
`tar -xzOf` lookup that the next `boot()` would otherwise pay —
see #233. Best-effort: a missing/unwritable cache dir just falls
back to the slow path on the next boot.

Call AFTER the tarball is on disk (so size+mtime match what the
cache key will be on read), passing exactly the config that was
baked into the tarball's `./machinen-config.json` (or `null` when
none was baked).

#### Parameters

##### imagePath

`string`

##### config

[`ImageConfig`](#imageconfig)

#### Returns

`void`

***

### restore()

> **restore**(`opts`): `Promise`\<[`VmHandle`](#vmhandle)\>

Restore a microVM from a snapshot bundle produced by
`vm.snapshot({ outDir })`. Reads the bundle's `meta.json` to
recover the source name, tars the CRIU image directory into a
temporary archive, then `boot()`s with that archive attached as
the scratch block device — the guest's `/sbin/machinen-restore`
untars `/dev/vdb` into tmpfs and runs `criu restore` against the
extracted images.

The boot knobs:

  - `snapshot: <tar>`     attaches the bundle archive as /dev/vdb
  - `name: <sourceName>/<pid>`  auto-named fork (unless caller
                                passed `name`)
  - `forkedFrom: <snapDir>`     lineage for `machinen ls`

Live-share mounts (#273): bundles created with active `liveMounts`
carry only the `{guest, host, mode}` triples in `meta.liveMounts`
— no bytes. By default `restore()` re-establishes each recorded
mount as-is; the boot-time `existsSync(host)` check fails loudly
(BOOT_MOUNT_HOST_NOT_FOUND) if the recorded host path is gone on
the restoring host. Pass `liveMounts: [...]` to override per-
`guest` (e.g. cross-host restore with remapped paths). Each
override entry's `guest` MUST match a recorded one — the field is
an override map, not an additive list. Bundles predating this
field have `meta.liveMounts === undefined`; in that case
`opts.liveMounts` is forwarded as-is for backward compatibility.

#### Parameters

##### opts

[`RestoreOptions`](#restoreoptions)

#### Returns

`Promise`\<[`VmHandle`](#vmhandle)\>

#### Throws

BOOT_SNAPSHOT_NOT_FOUND if `<snapDir>/img/`
  is missing or empty.

#### Throws

BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN if an entry in
  `opts.liveMounts` has a `guest` that doesn't appear in the
  bundle's `meta.liveMounts`.

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

### Native process images

- [`NativeProcessImageValidationError`](#nativeprocessimagevalidationerror)
- [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)
- [`NativeProcessImageRefusals`](#nativeprocessimagerefusals)
- [`NativeProcessImageManifest`](#nativeprocessimagemanifest)
- [`NativeMemoryMapping`](#nativememorymapping)
- [`NativeProcessImageMappings`](#nativeprocessimagemappings)
- [`NativeArm64Registers`](#nativearm64registers)
- [`NativeAmd64Registers`](#nativeamd64registers)
- [`NativeSimdFpuLiveSubset`](#nativesimdfpulivesubset)
- [`NativeSimdFpuState`](#nativesimdfpustate)
- [`NativeThreadState`](#nativethreadstate)
- [`NativeProcessImageThreads`](#nativeprocessimagethreads)
- [`NativeProcessResource`](#nativeprocessresource)
- [`NativeProcessImageResources`](#nativeprocessimageresources)
- [`NativeCodeLocationMapping`](#nativecodelocationmapping)
- [`NativeThreadTranslation`](#nativethreadtranslation)
- [`NativeMemoryRelocation`](#nativememoryrelocation)
- [`NativeProcessImageTranslation`](#nativeprocessimagetranslation)
- [`NativeProcessImageDocuments`](#nativeprocessimagedocuments)
- [`NativeProcessImageDocumentInput`](#nativeprocessimagedocumentinput)
- [`NativeProcessImageArchitecture`](#nativeprocessimagearchitecture)
- [`NativeProcessImageRefusalCode`](#nativeprocessimagerefusalcode)
- [`NativeMemoryMappingKind`](#nativememorymappingkind)
- [`NativeRegisterState`](#nativeregisterstate)
- [`NativeProcessResourceKind`](#nativeprocessresourcekind)
- [`NativeProcessImageJsonSchema`](#nativeprocessimagejsonschema)
- [`NATIVE_PROCESS_IMAGE_FORMAT_VERSION`](#native_process_image_format_version)
- [`NATIVE_PROCESS_IMAGE_FILES`](#native_process_image_files)
- [`nativeProcessImageArchitectures`](#nativeprocessimagearchitectures)
- [`nativeProcessImageRefusalCodes`](#nativeprocessimagerefusalcodes)
- [`nativeProcessImageSchemas`](#nativeprocessimageschemas)
- [`isNativeProcessImageBundle`](#isnativeprocessimagebundle)
- [`validateNativeProcessImageBundle`](#validatenativeprocessimagebundle)
- [`validateNativeProcessImageDocuments`](#validatenativeprocessimagedocuments)
- [`assertNativeProcessImageDocuments`](#assertnativeprocessimagedocuments)
- [`PortableMachineSnapshotArchitecture`](#portablemachinesnapshotarchitecture)
- [`PortableMachineSnapshotRefusalCode`](#portablemachinesnapshotrefusalcode)
- [`PortableMachineSnapshotRefusal`](#portablemachinesnapshotrefusal)
- [`PortableMachineSnapshotRefusals`](#portablemachinesnapshotrefusals)
- [`PortableMachineSnapshotManifest`](#portablemachinesnapshotmanifest)
- [`PortableMachineSnapshotDocuments`](#portablemachinesnapshotdocuments)
- [`PORTABLE_MACHINE_SNAPSHOT_FORMAT_VERSION`](#portable_machine_snapshot_format_version)
- [`PORTABLE_MACHINE_SNAPSHOT_FILES`](#portable_machine_snapshot_files)
- [`portableMachineSnapshotArchitectures`](#portablemachinesnapshotarchitectures)
- [`portableMachineSnapshotRefusalCodes`](#portablemachinesnapshotrefusalcodes)
- [`portableMachineSnapshotManifestSchema`](#portablemachinesnapshotmanifestschema)
- [`PortableMachineSnapshotValidationError`](#portablemachinesnapshotvalidationerror)
- [`crossIsaVmstateRestoreRefusal`](#crossisavmstaterestorerefusal)
- [`buildPortableMachineSnapshotManifestFromNativeProcessImage`](#buildportablemachinesnapshotmanifestfromnativeprocessimage)
- [`isPortableMachineSnapshotBundle`](#isportablemachinesnapshotbundle)
- [`validatePortableMachineSnapshotBundle`](#validateportablemachinesnapshotbundle)
- [`validatePortableMachineSnapshotManifest`](#validateportablemachinesnapshotmanifest)
- [`TargetGuestRestoreLoaderValidationError`](#targetguestrestoreloadervalidationerror)
- [`TargetGuestRestoreLoaderRefusalCode`](#targetguestrestoreloaderrefusalcode)
- [`TargetGuestRestoreResourceRecipe`](#targetguestrestoreresourcerecipe)
- [`TargetGuestRestoreResumeMode`](#targetguestrestoreresumemode)
- [`TargetGuestResumeRegisterName`](#targetguestresumeregistername)
- [`TargetGuestResumeRegisters`](#targetguestresumeregisters)
- [`TargetGuestRestoreContinuationDescriptor`](#targetguestrestorecontinuationdescriptor)
- [`TargetGuestRestoreDescriptor`](#targetguestrestoredescriptor)
- [`TargetGuestTranslatedFrameDescriptor`](#targetguesttranslatedframedescriptor)
- [`TargetGuestTranslatedFrameRegister`](#targetguesttranslatedframeregister)
- [`TargetGuestTranslatedFrameRegisterName`](#targetguesttranslatedframeregistername)
- [`TargetGuestTranslatedFrameSlot`](#targetguesttranslatedframeslot)
- [`TargetGuestMemoryMaterializationKind`](#targetguestmemorymaterializationkind)
- [`TargetGuestMemoryMaterializationEntry`](#targetguestmemorymaterializationentry)
- [`TargetGuestCopyCapturedBytesEntry`](#targetguestcopycapturedbytesentry)
- [`TargetGuestRecreateGuardEntry`](#targetguestrecreateguardentry)
- [`TargetGuestMemoryMaterializationRequest`](#targetguestmemorymaterializationrequest)
- [`TargetGuestMemoryMaterializationResult`](#targetguestmemorymaterializationresult)
- [`PortableMachineTargetRestoreDescriptorRequest`](#portablemachinetargetrestoredescriptorrequest)
- [`PortableMachineTargetRestoreDescriptorPlan`](#portablemachinetargetrestoredescriptorplan)
- [`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation)
- [`PortableMachineVmRestoreProofState`](#portablemachinevmrestoreproofstate)
- [`PortableMachineTargetContinuationKind`](#portablemachinetargetcontinuationkind)
- [`PortableMachineTargetFrameRestoreResult`](#portablemachinetargetframerestoreresult)
- [`PortableMachineTargetRegisterRestoreResult`](#portablemachinetargetregisterrestoreresult)
- [`PortableMachineTargetRflagsRestoreResult`](#portablemachinetargetrflagsrestoreresult)
- [`PortableMachineTargetTlsRestoreResult`](#portablemachinetargettlsrestoreresult)
- [`PortableMachineTargetThreadRestoreResult`](#portablemachinetargetthreadrestoreresult)
- [`PortableMachineTargetResourceStatus`](#portablemachinetargetresourcestatus)
- [`PortableMachineTargetResumePathResult`](#portablemachinetargetresumepathresult)
- [`PortableMachineTargetReturnChainResult`](#portablemachinetargetreturnchainresult)
- [`PortableMachineTargetStateConsumptionResult`](#portablemachinetargetstateconsumptionresult)
- [`PortableMachineTargetVerifierResult`](#portablemachinetargetverifierresult)
- [`PortableMachineVmRestoreProofRequest`](#portablemachinevmrestoreproofrequest)
- [`PortableMachineVmRestoreProofPlan`](#portablemachinevmrestoreproofplan)
- [`PortableMachineVmRestoreTargetResult`](#portablemachinevmrestoretargetresult)
- [`TARGET_GUEST_RESTORE_DESCRIPTOR_KIND`](#target_guest_restore_descriptor_kind)
- [`serializeTargetGuestRestoreDescriptor`](#serializetargetguestrestoredescriptor)
- [`parseTargetGuestRestoreDescriptor`](#parsetargetguestrestoredescriptor)
- [`validateTargetGuestRestoreDescriptor`](#validatetargetguestrestoredescriptor)
- [`planTargetGuestMemoryMaterialization`](#plantargetguestmemorymaterialization)
- [`planPortableMachineTargetRestoreDescriptor`](#planportablemachinetargetrestoredescriptor)
- [`planPortableMachineVmRestoreProof`](#planportablemachinevmrestoreproof)
- [`completePortableMachineVmRestoreProof`](#completeportablemachinevmrestoreproof)
- [`buildNativeActualResumeTrampolineArgs`](#buildnativeactualresumetrampolineargs)
- [`buildTargetGuestRestoreLoaderArgv`](#buildtargetguestrestoreloaderargv)
- [`NativeRegisterTranslationRequest`](#nativeregistertranslationrequest)
- [`NativeContinuationTarget`](#nativecontinuationtarget)
- [`NativeRegisterTranslationResult`](#nativeregistertranslationresult)
- [`NativeTlsThreadPointerRegister`](#nativetlsthreadpointerregister)
- [`NativeTlsAmd64SegmentBases`](#nativetlsamd64segmentbases)
- [`NativeThreadRestorePlan`](#nativethreadrestoreplan)
- [`NativeThreadRestorePlanRequest`](#nativethreadrestoreplanrequest)
- [`NativeSimdFpuLiveSubsetPolicy`](#nativesimdfpulivesubsetpolicy)
- [`NativeSimdFpuRestorePolicyResult`](#nativesimdfpurestorepolicyresult)
- [`NativeThreadTlsPolicyRequest`](#nativethreadtlspolicyrequest)
- [`NativeTlsSegmentBaseHandoffRequest`](#nativetlssegmentbasehandoffrequest)
- [`NativeTlsSegmentBaseHandoffResult`](#nativetlssegmentbasehandoffresult)
- [`NativeTlsTargetAccessPolicy`](#nativetlstargetaccesspolicy)
- [`translateNativeRegisterState`](#translatenativeregisterstate)
- [`planNativeThreadRestoreBoundary`](#plannativethreadrestoreboundary)
- [`NATIVE_SIMD_FPU_LIVE_SUBSET_POLICY`](#native_simd_fpu_live_subset_policy)
- [`planNativeSimdFpuLiveSubsetPolicy`](#plannativesimdfpulivesubsetpolicy)
- [`planNativeSimdFpuRestorePolicy`](#plannativesimdfpurestorepolicy)
- [`safeSimdFpuRefusal`](#safesimdfpurefusal)
- [`planNativeTlsSegmentBaseHandoff`](#plannativetlssegmentbasehandoff)
- [`safeTlsSegmentBaseRefusal`](#safetlssegmentbaserefusal)
- [`NativeActiveSyscallClass`](#nativeactivesyscallclass)
- [`NativeSleepTimerSyscallPolicy`](#nativesleeptimersyscallpolicy)
- [`NativePollTimeoutSyscallPolicy`](#nativepolltimeoutsyscallpolicy)
- [`NativePollTimeoutFdPolicy`](#nativepolltimeoutfdpolicy)
- [`NativeActiveSyscallPolicyOptions`](#nativeactivesyscallpolicyoptions)
- [`NativeSleepTimerDuration`](#nativesleeptimerduration)
- [`NativeModeledSleepTimerRemainingTime`](#nativemodeledsleeptimerremainingtime)
- [`NativeModeledSleepTimerState`](#nativemodeledsleeptimerstate)
- [`NativeModeledPpollTimeoutRemainingTime`](#nativemodeledppolltimeoutremainingtime)
- [`NativeModeledPpollTargetResource`](#nativemodeledppolltargetresource)
- [`NativeModeledPpollFdState`](#nativemodeledppollfdstate)
- [`NativeModeledPpollTimeoutState`](#nativemodeledppolltimeoutstate)
- [`NativeSleepTimerModelResult`](#nativesleeptimermodelresult)
- [`NativePpollTimeoutModelResult`](#nativeppolltimeoutmodelresult)
- [`NativeActiveSleepTimerContinuation`](#nativeactivesleeptimercontinuation)
- [`NativeActivePpollTimeoutContinuation`](#nativeactiveppolltimeoutcontinuation)
- [`NativeActiveSyscallContinuation`](#nativeactivesyscallcontinuation)
- [`NativeActiveSyscallClassification`](#nativeactivesyscallclassification)
- [`NativeActiveSyscallClassificationResult`](#nativeactivesyscallclassificationresult)
- [`modelNativeSleepTimerState`](#modelnativesleeptimerstate)
- [`modelNativePpollTimeoutState`](#modelnativeppolltimeoutstate)
- [`classifyNativeThreadSyscall`](#classifynativethreadsyscall)
- [`classifyNativeActiveSyscalls`](#classifynativeactivesyscalls)
- [`NativeCodeModule`](#nativecodemodule)
- [`NativeCodeSymbol`](#nativecodesymbol)
- [`NativeCodeMapRequest`](#nativecodemaprequest)
- [`NativeCodeMapResult`](#nativecodemapresult)
- [`buildNativeCodeMap`](#buildnativecodemap)
- [`NativeRealUtilityExecutableRange`](#nativerealutilityexecutablerange)
- [`NativeRealUtilitySourceModule`](#nativerealutilitysourcemodule)
- [`NativeRealUtilityTargetModule`](#nativerealutilitytargetmodule)
- [`NativeRealUtilityModuleExpectation`](#nativerealutilitymoduleexpectation)
- [`NativeRealUtilityTargetContinuationKind`](#nativerealutilitytargetcontinuationkind)
- [`NativeRealUtilityTargetSemanticContinuation`](#nativerealutilitytargetsemanticcontinuation)
- [`NativeRealUtilityContinuationStrategy`](#nativerealutilitycontinuationstrategy)
- [`NativeRealUtilitySemanticContinuationSelection`](#nativerealutilitysemanticcontinuationselection)
- [`NativeRealUtilitySyntheticContinuationSelection`](#nativerealutilitysyntheticcontinuationselection)
- [`NativeRealUtilityDeferredActiveSyscallLanding`](#nativerealutilitydeferredactivesyscalllanding)
- [`NativeRealUtilityResolvedLocation`](#nativerealutilityresolvedlocation)
- [`NativeRealUtilityCodeLocationRequest`](#nativerealutilitycodelocationrequest)
- [`NativeRealUtilityCodeLocationResult`](#nativerealutilitycodelocationresult)
- [`inventoryNativeSourceCodeModules`](#inventorynativesourcecodemodules)
- [`resolveNativeRealUtilityCodeLocations`](#resolvenativerealutilitycodelocations)
- [`NativeRealUtilityContinuationBoundary`](#nativerealutilitycontinuationboundary)
- [`NativeRealUtilityContinuationRequest`](#nativerealutilitycontinuationrequest)
- [`NativeRealUtilityContinuationPlan`](#nativerealutilitycontinuationplan)
- [`planNativeRealUtilityContinuationAttempt`](#plannativerealutilitycontinuationattempt)
- [`NativeActualRealUtilityContinuationBoundary`](#nativeactualrealutilitycontinuationboundary)
- [`NativeActualRealUtilityContinuationRequest`](#nativeactualrealutilitycontinuationrequest)
- [`NativeActualRealUtilityContinuationPlan`](#nativeactualrealutilitycontinuationplan)
- [`planNativeActualRealUtilityContinuationAttempt`](#plannativeactualrealutilitycontinuationattempt)
- [`NativeActualTargetModuleInventoryRequest`](#nativeactualtargetmoduleinventoryrequest)
- [`NativeActualTargetModuleInventoryResult`](#nativeactualtargetmoduleinventoryresult)
- [`inventoryNativeActualTargetModules`](#inventorynativeactualtargetmodules)
- [`NativeTargetModuleByteMaterializationRequest`](#nativetargetmodulebytematerializationrequest)
- [`NativeTargetModuleByteMaterialization`](#nativetargetmodulebytematerialization)
- [`NativeTargetModuleByteMaterializationResult`](#nativetargetmodulebytematerializationresult)
- [`materializeNativeTargetModuleBytes`](#materializenativetargetmodulebytes)
- [`NativeSyntheticContinuationTargetArch`](#nativesyntheticcontinuationtargetarch)
- [`NativeSyntheticContinuationByteSource`](#nativesyntheticcontinuationbytesource)
- [`NativeSyntheticContinuationByteEncoding`](#nativesyntheticcontinuationbyteencoding)
- [`NativeSyntheticContinuationSyscallAbi`](#nativesyntheticcontinuationsyscallabi)
- [`NativeSyntheticContinuationRegisterSetupAbi`](#nativesyntheticcontinuationregistersetupabi)
- [`NativeSyntheticContinuationFailureKind`](#nativesyntheticcontinuationfailurekind)
- [`NativeSyntheticContinuationFailureExitBucketCondition`](#nativesyntheticcontinuationfailureexitbucketcondition)
- [`NativeSyntheticContinuationRegister`](#nativesyntheticcontinuationregister)
- [`NativeSyntheticContinuationProvenanceSource`](#nativesyntheticcontinuationprovenancesource)
- [`NativeSyntheticSyscallArgumentDescriptor`](#nativesyntheticsyscallargumentdescriptor)
- [`NativeSyntheticSyscallDescriptor`](#nativesyntheticsyscalldescriptor)
- [`NativeSyntheticContinuationRegisterSetupDescriptor`](#nativesyntheticcontinuationregistersetupdescriptor)
- [`NativeSyntheticContinuationRestartContract`](#nativesyntheticcontinuationrestartcontract)
- [`NativeSyntheticContinuationStackSetupDescriptor`](#nativesyntheticcontinuationstacksetupdescriptor)
- [`NativeSyntheticContinuationFailureExitBucket`](#nativesyntheticcontinuationfailureexitbucket)
- [`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor)
- [`NativeSyntheticSyscallContinuationDescriptorRequest`](#nativesyntheticsyscallcontinuationdescriptorrequest)
- [`NativeSyntheticSyscallContinuationDescriptorPayload`](#nativesyntheticsyscallcontinuationdescriptorpayload)
- [`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor)
- [`NATIVE_SYNTHETIC_SYSCALL_EINTR_EXIT_STATUS`](#native_synthetic_syscall_eintr_exit_status)
- [`NATIVE_SYNTHETIC_SYSCALL_RESTART_EXIT_STATUS`](#native_synthetic_syscall_restart_exit_status)
- [`NATIVE_SYNTHETIC_SYSCALL_UNMODELED_RETURN_EXIT_STATUS`](#native_synthetic_syscall_unmodeled_return_exit_status)
- [`buildNativeSyntheticSyscallContinuationDescriptor`](#buildnativesyntheticsyscallcontinuationdescriptor)
- [`nativeSyntheticEintrErrno`](#nativesyntheticeintrerrno)
- [`nativeSyntheticRestartLikeErrnos`](#nativesyntheticrestartlikeerrnos)
- [`nativeSyntheticSyscallFailureExitBuckets`](#nativesyntheticsyscallfailureexitbuckets)
- [`nativeSyntheticSyscallRestartContract`](#nativesyntheticsyscallrestartcontract)
- [`nativeSyntheticExitProcessSuffix`](#nativesyntheticexitprocesssuffix)
- [`nativeSyntheticContinuationBytesHex`](#nativesyntheticcontinuationbyteshex)
- [`nativeSyntheticContinuationBytesSha256`](#nativesyntheticcontinuationbytessha256)
- [`nativeSyntheticContinuationDescriptorSha256`](#nativesyntheticcontinuationdescriptorsha256)
- [`NativeSyntheticPpollCompletionMode`](#nativesyntheticppollcompletionmode)
- [`NativeSyntheticPpollSyscallProvenanceSource`](#nativesyntheticppollsyscallprovenancesource)
- [`NativeSyntheticPpollSyscallArgumentProvenance`](#nativesyntheticppollsyscallargumentprovenance)
- [`NativeSyntheticPpollSyscallCompletionProvenance`](#nativesyntheticppollsyscallcompletionprovenance)
- [`NativeSyntheticPpollSyscallRegisterSetupProvenance`](#nativesyntheticppollsyscallregistersetupprovenance)
- [`NativeSyntheticPpollSyscallStackSetupProvenance`](#nativesyntheticppollsyscallstacksetupprovenance)
- [`NativeSyntheticPpollSyscallContinuationProvenance`](#nativesyntheticppollsyscallcontinuationprovenance)
- [`NativeSyntheticPpollSyscallContinuationRequest`](#nativesyntheticppollsyscallcontinuationrequest)
- [`NativeSyntheticPpollSyscallContinuation`](#nativesyntheticppollsyscallcontinuation)
- [`NativeSyntheticPpollSyscallContinuationResult`](#nativesyntheticppollsyscallcontinuationresult)
- [`NATIVE_SYNTHETIC_PPOLL_SYSCALL_BUILD_ID`](#native_synthetic_ppoll_syscall_build_id)
- [`NATIVE_SYNTHETIC_PPOLL_SYSCALL_LOGICAL_NAME`](#native_synthetic_ppoll_syscall_logical_name)
- [`NATIVE_SYNTHETIC_PPOLL_SYSCALL_PATH`](#native_synthetic_ppoll_syscall_path)
- [`NATIVE_SYNTHETIC_PPOLL_SYSCALL_BASE`](#native_synthetic_ppoll_syscall_base)
- [`buildNativeSyntheticPpollSyscallContinuation`](#buildnativesyntheticppollsyscallcontinuation)
- [`NativeSyntheticSleepCompletionMode`](#nativesyntheticsleepcompletionmode)
- [`NativeSyntheticSleepSyscallProvenanceSource`](#nativesyntheticsleepsyscallprovenancesource)
- [`NativeSyntheticSleepSyscallArgumentProvenance`](#nativesyntheticsleepsyscallargumentprovenance)
- [`NativeSyntheticSleepSyscallCompletionProvenance`](#nativesyntheticsleepsyscallcompletionprovenance)
- [`NativeSyntheticSleepSyscallRegisterSetupProvenance`](#nativesyntheticsleepsyscallregistersetupprovenance)
- [`NativeSyntheticSleepSyscallStackSetupProvenance`](#nativesyntheticsleepsyscallstacksetupprovenance)
- [`NativeSyntheticSleepSyscallContinuationProvenance`](#nativesyntheticsleepsyscallcontinuationprovenance)
- [`NativeSyntheticSleepSyscallContinuationRequest`](#nativesyntheticsleepsyscallcontinuationrequest)
- [`NativeSyntheticSleepSyscallContinuation`](#nativesyntheticsleepsyscallcontinuation)
- [`NativeSyntheticSleepSyscallContinuationResult`](#nativesyntheticsleepsyscallcontinuationresult)
- [`NATIVE_SYNTHETIC_SLEEP_SYSCALL_BUILD_ID`](#native_synthetic_sleep_syscall_build_id)
- [`NATIVE_SYNTHETIC_SLEEP_SYSCALL_LOGICAL_NAME`](#native_synthetic_sleep_syscall_logical_name)
- [`NATIVE_SYNTHETIC_SLEEP_SYSCALL_PATH`](#native_synthetic_sleep_syscall_path)
- [`NATIVE_SYNTHETIC_SLEEP_SYSCALL_BASE`](#native_synthetic_sleep_syscall_base)
- [`NATIVE_SYNTHETIC_SLEEP_SYSCALL_EINTR_EXIT_STATUS`](#native_synthetic_sleep_syscall_eintr_exit_status)
- [`NATIVE_SYNTHETIC_SLEEP_SYSCALL_FAILURE_EXIT_STATUS`](#native_synthetic_sleep_syscall_failure_exit_status)
- [`NATIVE_SYNTHETIC_SLEEP_SYSCALL_RESTART_EXIT_STATUS`](#native_synthetic_sleep_syscall_restart_exit_status)
- [`NATIVE_SYNTHETIC_SLEEP_SYSCALL_UNMODELED_RETURN_EXIT_STATUS`](#native_synthetic_sleep_syscall_unmodeled_return_exit_status)
- [`buildNativeSyntheticSleepSyscallContinuation`](#buildnativesyntheticsleepsyscallcontinuation)
- [`NativeTargetLandingModuleProvenance`](#nativetargetlandingmoduleprovenance)
- [`NativeTargetLandingSectionProvenance`](#nativetargetlandingsectionprovenance)
- [`NativeTargetLandingSymbolProvenance`](#nativetargetlandingsymbolprovenance)
- [`NativeTargetLandingFdeProvenance`](#nativetargetlandingfdeprovenance)
- [`NativeTargetLandingDisassemblyProvenance`](#nativetargetlandingdisassemblyprovenance)
- [`NativeTargetLandingInstructionBoundary`](#nativetargetlandinginstructionboundary)
- [`NativeTargetLandingInstructionBoundaryState`](#nativetargetlandinginstructionboundarystate)
- [`NativeTargetResumeLandingProvenance`](#nativetargetresumelandingprovenance)
- [`NativeTargetResumeLandingInspectionRequest`](#nativetargetresumelandinginspectionrequest)
- [`inspectNativeTargetResumeLanding`](#inspectnativetargetresumelanding)
- [`nativeTargetResumeLandingRefusals`](#nativetargetresumelandingrefusals)
- [`NativeTargetUnwindRegister`](#nativetargetunwindregister)
- [`NativeTargetCalleeSavedPolicy`](#nativetargetcalleesavedpolicy)
- [`NativeTargetCalleeSavedSlot`](#nativetargetcalleesavedslot)
- [`NativeTargetUnwindFrameRule`](#nativetargetunwindframerule)
- [`NativeTargetEhFrameTextParseRequest`](#nativetargetehframetextparserequest)
- [`NativeTargetEhFrameTextParseResult`](#nativetargetehframetextparseresult)
- [`NativeTargetUnwindMatchRequest`](#nativetargetunwindmatchrequest)
- [`NativeTargetUnwindFrameMatch`](#nativetargetunwindframematch)
- [`NativeTargetUnwindMatchResult`](#nativetargetunwindmatchresult)
- [`parseNativeTargetEhFrameText`](#parsenativetargetehframetext)
- [`matchNativeTargetUnwindFrame`](#matchnativetargetunwindframe)
- [`NativeTargetFrameStateRegister`](#nativetargetframestateregister)
- [`NativeTargetFrameStateValueSource`](#nativetargetframestatevaluesource)
- [`NativeSyntheticTargetCallerFrameStatePolicy`](#nativesynthetictargetcallerframestatepolicy)
- [`NativeTargetFrameRegisterValue`](#nativetargetframeregistervalue)
- [`NativeTargetFrameStateRequirement`](#nativetargetframestaterequirement)
- [`NativeTargetFrameStateMaterialization`](#nativetargetframestatematerialization)
- [`NativeTargetFrameStateMaterializationRequest`](#nativetargetframestatematerializationrequest)
- [`NativeTargetFrameStateMaterializationResult`](#nativetargetframestatematerializationresult)
- [`planNativeTargetFrameStateMaterialization`](#plannativetargetframestatematerialization)
- [`NativeSyntheticTargetCallerFramePolicy`](#nativesynthetictargetcallerframepolicy)
- [`NativeSyntheticTargetCallerFrameSlot`](#nativesynthetictargetcallerframeslot)
- [`NativeSyntheticTargetCallerFrame`](#nativesynthetictargetcallerframe)
- [`NativeSyntheticTargetCallerFramePlanRequest`](#nativesynthetictargetcallerframeplanrequest)
- [`NativeSyntheticTargetCallerFramePlanResult`](#nativesynthetictargetcallerframeplanresult)
- [`planNativeSyntheticTargetCallerFrame`](#plannativesynthetictargetcallerframe)
- [`NativeTargetResumeExecutionAttempt`](#nativetargetresumeexecutionattempt)
- [`NativeTargetResumeExecutionAttemptStatus`](#nativetargetresumeexecutionattemptstatus)
- [`NativeTargetResumeFaultBoundary`](#nativetargetresumefaultboundary)
- [`NativeTargetResumeFaultClassification`](#nativetargetresumefaultclassification)
- [`NativeTargetResumeFaultClassificationOptions`](#nativetargetresumefaultclassificationoptions)
- [`NativeTargetResumeFaultClassificationResult`](#nativetargetresumefaultclassificationresult)
- [`NativeTargetResumeFaultRegisters`](#nativetargetresumefaultregisters)
- [`NativeTargetResumeExecutionMode`](#nativetargetresumeexecutionmode)
- [`NativeTargetResumeExecutor`](#nativetargetresumeexecutor)
- [`NativeTargetResumeExecutionPlan`](#nativetargetresumeexecutionplan)
- [`NativeTargetResumeExecutionPlanRequest`](#nativetargetresumeexecutionplanrequest)
- [`NativeTargetResumeExecutionPlanResult`](#nativetargetresumeexecutionplanresult)
- [`classifyNativeTargetResumeExecutionAttempt`](#classifynativetargetresumeexecutionattempt)
- [`planNativeTargetResumeExecution`](#plannativetargetresumeexecution)
- [`NativeReturnChainFrame`](#nativereturnchainframe)
- [`NativeReturnChainPlan`](#nativereturnchainplan)
- [`NativeReturnChainPlanFrame`](#nativereturnchainplanframe)
- [`NativeReturnChainPlanRequest`](#nativereturnchainplanrequest)
- [`planNativeReturnChain`](#plannativereturnchain)
- [`NativeStackFrame`](#nativestackframe)
- [`NativeStackPointerRange`](#nativestackpointerrange)
- [`NativeStackSlot`](#nativestackslot)
- [`NativeStackTranslationRequest`](#nativestacktranslationrequest)
- [`NativeStackTranslationResult`](#nativestacktranslationresult)
- [`NativeStackWindowMaterializationPlan`](#nativestackwindowmaterializationplan)
- [`NativeStackWindowMaterializationRequest`](#nativestackwindowmaterializationrequest)
- [`planNativeStackWindowMaterialization`](#plannativestackwindowmaterialization)
- [`translateNativeStack`](#translatenativestack)
- [`NativeUnwindFrameRule`](#nativeunwindframerule)
- [`NativeUnwindStackWord`](#nativeunwindstackword)
- [`NativeEhFrameTextParseRequest`](#nativeehframetextparserequest)
- [`NativeEhFrameTextParseResult`](#nativeehframetextparseresult)
- [`NativeUnwindFrameDiscoveryRequest`](#nativeunwindframediscoveryrequest)
- [`NativeDiscoveredUnwindFrame`](#nativediscoveredunwindframe)
- [`NativeUnwindFrameDiscoveryResult`](#nativeunwindframediscoveryresult)
- [`NativeUnwindMetadataKind`](#nativeunwindmetadatakind)
- [`NativeUnwindRegister`](#nativeunwindregister)
- [`discoverNativeUnwindFrames`](#discovernativeunwindframes)
- [`nativeUnwindReturnAddressSlot`](#nativeunwindreturnaddressslot)
- [`parseNativeEhFrameText`](#parsenativeehframetext)
- [`NativeMemoryWord`](#nativememoryword)
- [`NativeMemoryTranslationRequest`](#nativememorytranslationrequest)
- [`NativeMemoryTranslationResult`](#nativememorytranslationresult)
- [`translateNativeMemory`](#translatenativememory)
- [`NativeDebugMemoryField`](#nativedebugmemoryfield)
- [`NativeDebugMemoryObject`](#nativedebugmemoryobject)
- [`NativeDebugAddressTranslation`](#nativedebugaddresstranslation)
- [`NativeDebugMemoryPointerClassificationRequest`](#nativedebugmemorypointerclassificationrequest)
- [`NativeDebugMemoryPointerClassificationResult`](#nativedebugmemorypointerclassificationresult)
- [`NativeDebugMemoryMetadataSource`](#nativedebugmemorymetadatasource)
- [`NativeDebugMemoryFieldClassification`](#nativedebugmemoryfieldclassification)
- [`classifyNativeDebugMemoryPointers`](#classifynativedebugmemorypointers)
- [`NativeMappingMaterializationAction`](#nativemappingmaterializationaction)
- [`NativeMappingMaterializationStep`](#nativemappingmaterializationstep)
- [`NativeMappingMaterializationRequest`](#nativemappingmaterializationrequest)
- [`NativeMappingMaterializationResult`](#nativemappingmaterializationresult)
- [`planNativeMappingMaterialization`](#plannativemappingmaterialization)
- [`NativeInheritedStdioPolicy`](#nativeinheritedstdiopolicy)
- [`NativeResourceTranslationRequest`](#nativeresourcetranslationrequest)
- [`NativeResourceTranslationResult`](#nativeresourcetranslationresult)
- [`NativeTargetFdTableEntryKind`](#nativetargetfdtableentrykind)
- [`NativeTargetFdTableEntry`](#nativetargetfdtableentry)
- [`NativeTargetFdTablePlanRequest`](#nativetargetfdtableplanrequest)
- [`NativeTargetFdTablePlan`](#nativetargetfdtableplan)
- [`translateNativeResources`](#translatenativeresources)
- [`planNativeTargetFdTable`](#plannativetargetfdtable)

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

### NativeProcessImageValidationError

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new NativeProcessImageValidationError**(`errors`): [`NativeProcessImageValidationError`](#nativeprocessimagevalidationerror)

###### Parameters

###### errors

`string`[]

###### Returns

[`NativeProcessImageValidationError`](#nativeprocessimagevalidationerror)

###### Overrides

`Error.constructor`

#### Properties

##### errors

> `readonly` **errors**: `string`[]

***

### PortableMachineSnapshotValidationError

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new PortableMachineSnapshotValidationError**(`message`): [`PortableMachineSnapshotValidationError`](#portablemachinesnapshotvalidationerror)

###### Parameters

###### message

`string`

###### Returns

[`PortableMachineSnapshotValidationError`](#portablemachinesnapshotvalidationerror)

###### Overrides

`Error.constructor`

***

### TargetGuestRestoreLoaderValidationError

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new TargetGuestRestoreLoaderValidationError**(`code`, `message`): [`TargetGuestRestoreLoaderValidationError`](#targetguestrestoreloadervalidationerror)

###### Parameters

###### code

[`TargetGuestRestoreLoaderRefusalCode`](#targetguestrestoreloaderrefusalcode)

###### message

`string`

###### Returns

[`TargetGuestRestoreLoaderValidationError`](#targetguestrestoreloadervalidationerror)

###### Overrides

`Error.constructor`

#### Properties

##### code

> `readonly` **code**: [`TargetGuestRestoreLoaderRefusalCode`](#targetguestrestoreloaderrefusalcode)

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

> **kind**: `"boot"` \| `"provision"` \| `"snapshot"` \| `"restore"`

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

### NativeActiveSyscallPolicyOptions

#### Properties

##### sleepTimerPolicy?

> `optional` **sleepTimerPolicy?**: [`NativeSleepTimerSyscallPolicy`](#nativesleeptimersyscallpolicy)

##### pollTimeoutPolicy?

> `optional` **pollTimeoutPolicy?**: [`NativePollTimeoutSyscallPolicy`](#nativepolltimeoutsyscallpolicy)

##### pollTimeoutFdPolicy?

> `optional` **pollTimeoutFdPolicy?**: [`NativePollTimeoutFdPolicy`](#nativepolltimeoutfdpolicy)

##### documents?

> `optional` **documents?**: [`NativeProcessImageDocuments`](#nativeprocessimagedocuments)

***

### NativeSleepTimerDuration

#### Extended by

- [`NativeModeledPpollTimeoutRemainingTime`](#nativemodeledppolltimeoutremainingtime)
- [`NativeModeledSleepTimerRemainingTime`](#nativemodeledsleeptimerremainingtime)

#### Properties

##### seconds

> **seconds**: `string`

##### nanoseconds

> **nanoseconds**: `number`

***

### NativeModeledSleepTimerRemainingTime

#### Extends

- [`NativeSleepTimerDuration`](#nativesleeptimerduration)

#### Properties

##### seconds

> **seconds**: `string`

###### Inherited from

[`NativeSleepTimerDuration`](#nativesleeptimerduration).[`seconds`](#seconds)

##### nanoseconds

> **nanoseconds**: `number`

###### Inherited from

[`NativeSleepTimerDuration`](#nativesleeptimerduration).[`nanoseconds`](#nanoseconds)

##### state

> **state**: `"modeled"`

##### kind

> **kind**: `"relative-duration"`

##### source

> **source**: `"active-syscall-request-timespec"`

##### precision

> **precision**: `"requested-duration-upper-bound"`

***

### NativeModeledPpollTimeoutRemainingTime

#### Extends

- [`NativeSleepTimerDuration`](#nativesleeptimerduration)

#### Properties

##### seconds

> **seconds**: `string`

###### Inherited from

[`NativeSleepTimerDuration`](#nativesleeptimerduration).[`seconds`](#seconds)

##### nanoseconds

> **nanoseconds**: `number`

###### Inherited from

[`NativeSleepTimerDuration`](#nativesleeptimerduration).[`nanoseconds`](#nanoseconds)

##### state

> **state**: `"modeled"`

##### kind

> **kind**: `"relative-duration"`

##### source

> **source**: `"active-syscall-ppoll-timeout"`

##### precision

> **precision**: `"requested-duration-upper-bound"`

***

### NativeModeledSleepTimerState

#### Properties

##### kind

> **kind**: `"relative-duration"`

##### syscallName

> **syscallName**: `string`

##### argumentSource

> **argumentSource**: `"proc-syscall"` \| `"registers"`

##### clockId?

> `optional` **clockId?**: `number`

##### flags?

> `optional` **flags?**: `number`

##### requestPointer

> **requestPointer**: `string`

##### remainderPointer?

> `optional` **remainderPointer?**: `string`

##### requestedTime

> **requestedTime**: [`NativeSleepTimerDuration`](#nativesleeptimerduration)

##### remainingTime

> **remainingTime**: [`NativeModeledSleepTimerRemainingTime`](#nativemodeledsleeptimerremainingtime)

***

### NativeModeledPpollFdState

#### Properties

##### fd

> **fd**: `number`

##### events

> **events**: `number`

##### revents

> **revents**: `number`

##### sourceAddress

> **sourceAddress**: `string`

##### resourceId?

> `optional` **resourceId?**: `string`

##### targetResource

> **targetResource**: [`NativeModeledPpollTargetResource`](#nativemodeledppolltargetresource)

***

### NativeModeledPpollTimeoutState

#### Properties

##### kind

> **kind**: `"relative-duration"`

##### syscallName

> **syscallName**: `"ppoll"`

##### argumentSource

> **argumentSource**: `"proc-syscall"` \| `"registers"`

##### fdsPointer

> **fdsPointer**: `string`

##### nfds

> **nfds**: `0` \| `1`

##### pollFds?

> `optional` **pollFds?**: [`NativeModeledPpollFdState`](#nativemodeledppollfdstate)[]

##### timeoutPointer

> **timeoutPointer**: `string`

##### sigmaskPointer

> **sigmaskPointer**: `"0x0"`

##### sigsetSize?

> `optional` **sigsetSize?**: `string`

##### requestedTime

> **requestedTime**: [`NativeSleepTimerDuration`](#nativesleeptimerduration)

##### remainingTime

> **remainingTime**: [`NativeModeledPpollTimeoutRemainingTime`](#nativemodeledppolltimeoutremainingtime)

***

### NativeActiveSleepTimerContinuation

#### Properties

##### threadId

> **threadId**: `string`

##### syscallClass

> **syscallClass**: `"sleep-timer"`

##### action

> **action**: `"defer-target-resume"`

##### syscall

> **syscall**: `object`

###### state

> **state**: `"outside-syscall"` \| `"inside-syscall"` \| `"restart-block"`

###### number?

> `optional` **number?**: `number`

###### name?

> `optional` **name?**: `string`

###### arguments?

> `optional` **arguments?**: `string`[]

###### stackPointer?

> `optional` **stackPointer?**: `string`

###### instructionPointer?

> `optional` **instructionPointer?**: `string`

##### metadata

> **metadata**: `object`

###### remainingTime

> **remainingTime**: [`NativeModeledSleepTimerRemainingTime`](#nativemodeledsleeptimerremainingtime)

###### sleepTimer

> **sleepTimer**: [`NativeModeledSleepTimerState`](#nativemodeledsleeptimerstate)

###### policy

> **policy**: `"conservative-target-timer-rearm-required"`

***

### NativeActivePpollTimeoutContinuation

#### Properties

##### threadId

> **threadId**: `string`

##### syscallClass

> **syscallClass**: `"poll-timeout"`

##### action

> **action**: `"defer-target-resume"`

##### syscall

> **syscall**: `object`

###### state

> **state**: `"outside-syscall"` \| `"inside-syscall"` \| `"restart-block"`

###### number?

> `optional` **number?**: `number`

###### name?

> `optional` **name?**: `string`

###### arguments?

> `optional` **arguments?**: `string`[]

###### stackPointer?

> `optional` **stackPointer?**: `string`

###### instructionPointer?

> `optional` **instructionPointer?**: `string`

##### metadata

> **metadata**: `object`

###### remainingTime

> **remainingTime**: [`NativeModeledPpollTimeoutRemainingTime`](#nativemodeledppolltimeoutremainingtime)

###### ppollTimeout

> **ppollTimeout**: [`NativeModeledPpollTimeoutState`](#nativemodeledppolltimeoutstate)

###### policy

> **policy**: `"conservative-target-ppoll-timeout-rearm-required"`

***

### NativeActiveSyscallClassification

#### Properties

##### threadId

> **threadId**: `string`

##### state

> **state**: `"outside-syscall"` \| `"inside-syscall"` \| `"restart-block"`

##### syscallNumber?

> `optional` **syscallNumber?**: `number`

##### syscallName?

> `optional` **syscallName?**: `string`

##### class

> **class**: [`NativeActiveSyscallClass`](#nativeactivesyscallclass)

##### resumable

> **resumable**: `false`

##### refusal?

> `optional` **refusal?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

##### continuation?

> `optional` **continuation?**: [`NativeActiveSyscallContinuation`](#nativeactivesyscallcontinuation)

***

### NativeActiveSyscallClassificationResult

#### Properties

##### classifications

> **classifications**: [`NativeActiveSyscallClassification`](#nativeactivesyscallclassification)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

##### continuations

> **continuations**: [`NativeActiveSyscallContinuation`](#nativeactivesyscallcontinuation)[]

***

### NativeActualRealUtilityContinuationRequest

#### Extends

- [`NativeRealUtilityContinuationRequest`](#nativerealutilitycontinuationrequest)

#### Properties

##### targetModuleByteRefusals?

> `optional` **targetModuleByteRefusals?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

##### targetModuleBytesMaterialized?

> `optional` **targetModuleBytesMaterialized?**: `boolean`

##### targetCallerFrameRefusals?

> `optional` **targetCallerFrameRefusals?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

##### targetCallerFrameMaterialized?

> `optional` **targetCallerFrameMaterialized?**: `boolean`

##### targetResumeExecutionRefusals?

> `optional` **targetResumeExecutionRefusals?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

##### targetResumeExecutionPlanned?

> `optional` **targetResumeExecutionPlanned?**: `boolean`

##### threadRefusals?

> `optional` **threadRefusals?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

###### Inherited from

[`NativeRealUtilityContinuationRequest`](#nativerealutilitycontinuationrequest).[`threadRefusals`](#threadrefusals-1)

##### resourceRefusals?

> `optional` **resourceRefusals?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

###### Inherited from

[`NativeRealUtilityContinuationRequest`](#nativerealutilitycontinuationrequest).[`resourceRefusals`](#resourcerefusals-1)

##### mappingRefusals?

> `optional` **mappingRefusals?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

###### Inherited from

[`NativeRealUtilityContinuationRequest`](#nativerealutilitycontinuationrequest).[`mappingRefusals`](#mappingrefusals-1)

##### codeLocations

> **codeLocations**: [`NativeCodeLocationMapping`](#nativecodelocationmapping)[]

###### Inherited from

[`NativeRealUtilityContinuationRequest`](#nativerealutilitycontinuationrequest).[`codeLocations`](#codelocations-5)

##### sourceFrames

> **sourceFrames**: [`NativeDiscoveredUnwindFrame`](#nativediscoveredunwindframe)[]

###### Inherited from

[`NativeRealUtilityContinuationRequest`](#nativerealutilitycontinuationrequest).[`sourceFrames`](#sourceframes-1)

##### sourceFrameRefusals?

> `optional` **sourceFrameRefusals?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

###### Inherited from

[`NativeRealUtilityContinuationRequest`](#nativerealutilitycontinuationrequest).[`sourceFrameRefusals`](#sourceframerefusals-1)

##### sourceUnwindRequired?

> `optional` **sourceUnwindRequired?**: `boolean`

###### Inherited from

[`NativeRealUtilityContinuationRequest`](#nativerealutilitycontinuationrequest).[`sourceUnwindRequired`](#sourceunwindrequired-1)

##### targetUnwind?

> `optional` **targetUnwind?**: [`NativeTargetUnwindMatchResult`](#nativetargetunwindmatchresult)

###### Inherited from

[`NativeRealUtilityContinuationRequest`](#nativerealutilitycontinuationrequest).[`targetUnwind`](#targetunwind-1)

##### targetUnwindMatched?

> `optional` **targetUnwindMatched?**: `boolean`

###### Inherited from

[`NativeRealUtilityContinuationRequest`](#nativerealutilitycontinuationrequest).[`targetUnwindMatched`](#targetunwindmatched-1)

##### targetFrameState?

> `optional` **targetFrameState?**: [`NativeTargetFrameStateMaterializationResult`](#nativetargetframestatematerializationresult)

###### Inherited from

[`NativeRealUtilityContinuationRequest`](#nativerealutilitycontinuationrequest).[`targetFrameState`](#targetframestate-1)

##### targetFrameStateMaterialized?

> `optional` **targetFrameStateMaterialized?**: `boolean`

###### Inherited from

[`NativeRealUtilityContinuationRequest`](#nativerealutilitycontinuationrequest).[`targetFrameStateMaterialized`](#targetframestatematerialized-1)

***

### NativeActualRealUtilityContinuationPlan

#### Properties

##### state

> **state**: `"refused"` \| `"ready"`

##### blockingBoundary

> **blockingBoundary**: [`NativeActualRealUtilityContinuationBoundary`](#nativeactualrealutilitycontinuationboundary)

##### blockingRefusal?

> `optional` **blockingRefusal?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

##### attemptedResume

> **attemptedResume**: `false`

##### sourceTextReusedAsTargetCode

> **sourceTextReusedAsTargetCode**: `false`

##### sourceIsaEmulationUsed

> **sourceIsaEmulationUsed**: `false`

##### sidecarRuntimeUsed

> **sidecarRuntimeUsed**: `false`

***

### NativeActualTargetModuleInventoryRequest

#### Properties

##### sourceModules

> **sourceModules**: [`NativeRealUtilitySourceModule`](#nativerealutilitysourcemodule)[]

##### targetArch

> **targetArch**: `"amd64"` \| `"arm64"`

##### targetRoot?

> `optional` **targetRoot?**: `string`

##### explicitTargetModulePath?

> `optional` **explicitTargetModulePath?**: `string`

##### loadBiasBase?

> `optional` **loadBiasBase?**: `string`

***

### NativeActualTargetModuleInventoryResult

#### Properties

##### targetModules

> **targetModules**: [`NativeRealUtilityTargetModule`](#nativerealutilitytargetmodule)[]

***

### NativeCodeModule

#### Extended by

- [`NativeRealUtilitySourceModule`](#nativerealutilitysourcemodule)
- [`NativeRealUtilityTargetModule`](#nativerealutilitytargetmodule)

#### Properties

##### id

> **id**: `string`

##### logicalName

> **logicalName**: `string`

##### path

> **path**: `string`

##### arch?

> `optional` **arch?**: `"amd64"` \| `"arm64"`

##### kind

> **kind**: `"unknown"` \| `"vdso"` \| `"executable"` \| `"pie-executable"` \| `"shared-object"`

##### buildId

> **buildId**: `string`

##### loadBias

> **loadBias**: `string`

##### textMapping

> **textMapping**: `string`

***

### NativeCodeSymbol

#### Properties

##### name

> **name**: `string`

##### mapping

> **mapping**: `string`

##### address

> **address**: `string`

##### sizeBytes?

> `optional` **sizeBytes?**: `number`

##### buildId?

> `optional` **buildId?**: `string`

##### metadata

> **metadata**: `"symbol"` \| `"dwarf"` \| `"sidecar"`

##### moduleId?

> `optional` **moduleId?**: `string`

##### relativeAddress?

> `optional` **relativeAddress?**: `string`

***

### NativeCodeMapRequest

#### Properties

##### expectedTargetBuildId

> **expectedTargetBuildId**: `string`

##### targetBuildId

> **targetBuildId**: `string`

##### sourceSymbols

> **sourceSymbols**: [`NativeCodeSymbol`](#nativecodesymbol)[]

##### targetSymbols

> **targetSymbols**: [`NativeCodeSymbol`](#nativecodesymbol)[]

##### requestedLocations

> **requestedLocations**: `object`[]

###### id

> **id**: `string`

###### symbol

> **symbol**: `string`

###### sourceAddress?

> `optional` **sourceAddress?**: `string`

##### sourceModules?

> `optional` **sourceModules?**: [`NativeCodeModule`](#nativecodemodule)[]

##### targetModules?

> `optional` **targetModules?**: [`NativeCodeModule`](#nativecodemodule)[]

***

### NativeCodeMapResult

#### Properties

##### codeLocations

> **codeLocations**: [`NativeCodeLocationMapping`](#nativecodelocationmapping)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeDebugMemoryField

#### Properties

##### name

> **name**: `string`

##### offset

> **offset**: `number`

##### sizeBytes

> **sizeBytes**: `number`

##### sourceValue

> **sourceValue**: `string`

##### classification

> **classification**: [`NativeDebugMemoryFieldClassification`](#nativedebugmemoryfieldclassification)

##### metadata

> **metadata**: [`NativeDebugMemoryMetadataSource`](#nativedebugmemorymetadatasource)

***

### NativeDebugMemoryObject

#### Properties

##### id

> **id**: `string`

##### mapping

> **mapping**: `string`

##### sourceStart

> **sourceStart**: `string`

##### mappingOffset?

> `optional` **mappingOffset?**: `number`

##### fields

> **fields**: [`NativeDebugMemoryField`](#nativedebugmemoryfield)[]

***

### NativeDebugAddressTranslation

#### Properties

##### id

> **id**: `string`

##### sourceStart

> **sourceStart**: `string`

##### sourceEnd

> **sourceEnd**: `string`

##### targetStart

> **targetStart**: `string`

***

### NativeDebugMemoryPointerClassificationRequest

#### Properties

##### objects

> **objects**: [`NativeDebugMemoryObject`](#nativedebugmemoryobject)[]

##### addressTranslations

> **addressTranslations**: [`NativeDebugAddressTranslation`](#nativedebugaddresstranslation)[]

##### codeLocations?

> `optional` **codeLocations?**: [`NativeCodeLocationMapping`](#nativecodelocationmapping)[]

***

### NativeDebugMemoryPointerClassificationResult

#### Properties

##### words

> **words**: [`NativeMemoryWord`](#nativememoryword)[]

##### preservedWords

> **preservedWords**: `number`

##### relocatableWords

> **relocatableWords**: `number`

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeMappingMaterializationStep

#### Properties

##### mapping

> **mapping**: `string`

##### kind

> **kind**: [`NativeMemoryMappingKind`](#nativememorymappingkind)

##### action

> **action**: [`NativeMappingMaterializationAction`](#nativemappingmaterializationaction)

##### targetStart?

> `optional` **targetStart?**: `string`

##### sizeBytes

> **sizeBytes**: `number`

##### permissions

> **permissions**: `object`

###### read

> **read**: `boolean`

###### write

> **write**: `boolean`

###### execute

> **execute**: `boolean`

###### private

> **private**: `boolean`

###### shared

> **shared**: `boolean`

##### targetFile?

> `optional` **targetFile?**: `object`

###### path

> **path**: `string`

###### offset

> **offset**: `number`

###### buildId?

> `optional` **buildId?**: `string`

###### sha256?

> `optional` **sha256?**: `string`

##### sourceBytes?

> `optional` **sourceBytes?**: `object`

###### offset

> **offset**: `number`

###### sizeBytes

> **sizeBytes**: `number`

##### refusal?

> `optional` **refusal?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

***

### NativeMappingMaterializationRequest

#### Properties

##### mappings

> **mappings**: [`NativeMemoryMapping`](#nativememorymapping)[]

##### memorySizeBytes

> **memorySizeBytes**: `number`

##### targetFileBuildIds?

> `optional` **targetFileBuildIds?**: `Record`\<`string`, `string`\>

***

### NativeMappingMaterializationResult

#### Properties

##### steps

> **steps**: [`NativeMappingMaterializationStep`](#nativemappingmaterializationstep)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeMemoryWord

#### Properties

##### mapping

> **mapping**: `string`

##### offset

> **offset**: `number`

##### sourceValue

> **sourceValue**: `string`

##### classification

> **classification**: `"pointer"` \| `"code-pointer"` \| `"thread-pointer"` \| `"ambiguous"` \| `"integer"`

##### targetValue?

> `optional` **targetValue?**: `string`

##### proof

> **proof**: `"symbol"` \| `"none"` \| `"dwarf"` \| `"sidecar"` \| `"policy"`

***

### NativeMemoryTranslationRequest

#### Properties

##### words

> **words**: [`NativeMemoryWord`](#nativememoryword)[]

***

### NativeMemoryTranslationResult

#### Properties

##### relocations

> **relocations**: [`NativeMemoryRelocation`](#nativememoryrelocation)[]

##### preservedWords

> **preservedWords**: `number`

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeProcessImageRefusal

#### Properties

##### code

> **code**: `"active-syscall"` \| `"architecture-pair-unsupported"` \| `"architecture-unsupported"` \| `"blocking-syscall-state-unsupported"` \| `"code-location-unknown"` \| `"fd-kind-unsupported"` \| `"futex-state-unsupported"` \| `"inherited-stdio-policy-required"` \| `"kernel-state-unsupported"` \| `"mapping-ambiguous"` \| `"mapping-captured-range-unsupported"` \| `"mapping-executable-unsupported"` \| `"mapping-permission-unsupported"` \| `"mapping-provenance-ambiguous"` \| `"mapping-shared-unsupported"` \| `"mapping-unreadable"` \| `"pointer-ambiguous"` \| `"resource-kind-unsupported"` \| `"non-stdio-kernel-state-unsupported"` \| `"rseq-state-unsupported"` \| `"signal-frame-active"` \| `"signal-state-unsupported"` \| `"simd-fpu-state-unsupported"` \| `"stdin-buffer-state-unsupported"` \| `"syscall-argument-state-unsupported"` \| `"syscall-restart-unsupported"` \| `"target-build-id-mismatch"` \| `"target-build-mismatch"` \| `"target-code-location-unresolved"` \| `"target-callee-saved-state-unsupported"` \| `"target-caller-frame-unavailable"` \| `"target-code-rva-unmapped"` \| `"target-fd-table-duplicate"` \| `"target-fd-table-missing"` \| `"target-frame-layout-unsupported"` \| `"target-frame-register-value-unavailable"` \| `"target-module-bytes-missing"` \| `"target-module-file-missing"` \| `"target-module-missing"` \| `"target-module-not-executable"` \| `"target-module-range-unreadable"` \| `"target-ppoll-syscall-continuation-missing"` \| `"target-ppoll-timeout-missing"` \| `"target-return-slot-unsupported"` \| `"target-resume-execution-unavailable"` \| `"target-resume-fault-invalid-code-landing"` \| `"target-resume-fault-outside-target-bytes"` \| `"target-resume-fault-privileged-instruction"` \| `"target-resume-fault-signal-unsupported"` \| `"target-resume-fault-timeout"` \| `"target-resume-fault-unmodeled-memory"` \| `"target-semantic-continuation-missing"` \| `"target-sleep-remaining-time-missing"` \| `"target-sleep-signal-restart-unsupported"` \| `"target-sleep-syscall-continuation-missing"` \| `"target-stack-window-unsupported"` \| `"target-synthetic-signal-interrupted-unsupported"` \| `"target-synthetic-signal-restart-unsupported"` \| `"target-synthetic-syscall-return-unmodeled"` \| `"thread-state-unsupported"` \| `"tls-state-unsupported"` \| `"return-slot-unreadable"` \| `"target-unwind-mismatch"` \| `"unwind-fde-missing"` \| `"unwind-metadata-missing"` \| `"unwind-rule-unsupported"` \| `"vdso-policy-unsupported"`

##### message

> **message**: `string`

##### detail?

> `optional` **detail?**: `Record`\<`string`, `unknown`\>

***

### NativeProcessImageRefusals

#### Properties

##### vocabularyVersion

> **vocabularyVersion**: `1`

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeProcessImageManifest

#### Properties

##### formatVersion

> **formatVersion**: `1`

##### kind

> **kind**: `"machinen.native-process-image"`

##### capture

> **capture**: `object`

###### method

> **method**: `"external-ptrace-procfs"`

###### sourceArch

> **sourceArch**: `"amd64"` \| `"arm64"`

###### pid?

> `optional` **pid?**: `number`

###### capturedAt?

> `optional` **capturedAt?**: `string`

##### target

> **target**: `object`

###### mode

> **mode**: `"native-cross-isa"`

###### arch

> **arch**: `"amd64"` \| `"arm64"`

###### abi

> **abi**: `"linux-user"`

##### process

> **process**: `object`

###### exe

> **exe**: `string`

###### argv

> **argv**: `string`[]

###### env

> **env**: `Record`\<`string`, `string`\>

###### cwd

> **cwd**: `string`

##### refusals

> **refusals**: [`NativeProcessImageRefusals`](#nativeprocessimagerefusals)

***

### NativeMemoryMapping

#### Properties

##### id

> **id**: `string`

##### kind

> **kind**: [`NativeMemoryMappingKind`](#nativememorymappingkind)

##### sourceStart

> **sourceStart**: `string`

##### sourceEnd

> **sourceEnd**: `string`

##### sizeBytes

> **sizeBytes**: `number`

##### permissions

> **permissions**: `object`

###### read

> **read**: `boolean`

###### write

> **write**: `boolean`

###### execute

> **execute**: `boolean`

###### private

> **private**: `boolean`

###### shared

> **shared**: `boolean`

##### file?

> `optional` **file?**: `object`

###### path

> **path**: `string`

###### offset

> **offset**: `number`

###### buildId?

> `optional` **buildId?**: `string`

###### sha256?

> `optional` **sha256?**: `string`

##### captured?

> `optional` **captured?**: `object`

###### file

> **file**: `"native-memory.bin"`

###### offset

> **offset**: `number`

###### sizeBytes

> **sizeBytes**: `number`

##### target

> **target**: `object`

###### materialization

> **materialization**: `"refuse"` \| `"translate"` \| `"recreate"` \| `"omit"`

###### targetStart?

> `optional` **targetStart?**: `string`

###### reason?

> `optional` **reason?**: `string`

##### refusal?

> `optional` **refusal?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

***

### NativeProcessImageMappings

#### Properties

##### formatVersion

> **formatVersion**: `1`

##### mappings

> **mappings**: [`NativeMemoryMapping`](#nativememorymapping)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusals`](#nativeprocessimagerefusals)

***

### NativeArm64Registers

#### Properties

##### arch

> **arch**: `"arm64"`

##### pc

> **pc**: `string`

##### sp

> **sp**: `string`

##### pstate

> **pstate**: `string`

##### x

> **x**: `string`[]

***

### NativeAmd64Registers

#### Properties

##### arch

> **arch**: `"amd64"`

##### rip

> **rip**: `string`

##### rsp

> **rsp**: `string`

##### rflags

> **rflags**: `string`

##### rax

> **rax**: `string`

##### rbx

> **rbx**: `string`

##### rcx

> **rcx**: `string`

##### rdx

> **rdx**: `string`

##### rsi

> **rsi**: `string`

##### rdi

> **rdi**: `string`

##### rbp

> **rbp**: `string`

##### r8

> **r8**: `string`

##### r9

> **r9**: `string`

##### r10

> **r10**: `string`

##### r11

> **r11**: `string`

##### r12

> **r12**: `string`

##### r13

> **r13**: `string`

##### r14

> **r14**: `string`

##### r15

> **r15**: `string`

##### fsBase

> **fsBase**: `string`

##### gsBase

> **gsBase**: `string`

***

### NativeThreadState

#### Properties

##### id

> **id**: `string`

##### lwpid?

> `optional` **lwpid?**: `number`

##### state

> **state**: `"stopped"`

##### stopReason

> **stopReason**: `"ptrace-stop"` \| `"signal-delivery-stop"` \| `"group-stop"`

##### stackMapping

> **stackMapping**: `string`

##### sourceRegisters

> **sourceRegisters**: [`NativeRegisterState`](#nativeregisterstate)

##### syscall

> **syscall**: `object`

###### state

> **state**: `"outside-syscall"` \| `"inside-syscall"` \| `"restart-block"`

###### number?

> `optional` **number?**: `number`

###### name?

> `optional` **name?**: `string`

###### arguments?

> `optional` **arguments?**: `string`[]

###### stackPointer?

> `optional` **stackPointer?**: `string`

###### instructionPointer?

> `optional` **instructionPointer?**: `string`

##### signal

> **signal**: `object`

###### blocked

> **blocked**: `string`[]

###### pending

> **pending**: `string`[]

###### activeFrame

> **activeFrame**: `boolean`

###### altStack

> **altStack**: `object`

###### altStack.state

> **state**: `"disabled"` \| `"unsupported"` \| `"enabled"`

###### altStack.sp?

> `optional` **sp?**: `string`

###### altStack.sizeBytes?

> `optional` **sizeBytes?**: `number`

###### altStack.refusal?

> `optional` **refusal?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

##### tls

> **tls**: `object`

###### threadPointer

> **threadPointer**: `string`

###### sourceRegister?

> `optional` **sourceRegister?**: [`NativeTlsThreadPointerRegister`](#nativetlsthreadpointerregister)

###### targetSegmentBases?

> `optional` **targetSegmentBases?**: [`NativeTlsAmd64SegmentBases`](#nativetlsamd64segmentbases)

###### rseq

> **rseq**: `object`

###### rseq.state

> **state**: `"unsupported"` \| `"absent"` \| `"captured"`

###### rseq.refusal?

> `optional` **refusal?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

##### simdFpu?

> `optional` **simdFpu?**: [`NativeSimdFpuState`](#nativesimdfpustate)

##### refusal?

> `optional` **refusal?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

***

### NativeProcessImageThreads

#### Properties

##### formatVersion

> **formatVersion**: `1`

##### threads

> **threads**: [`NativeThreadState`](#nativethreadstate)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusals`](#nativeprocessimagerefusals)

***

### NativeProcessResource

#### Properties

##### id

> **id**: `string`

##### kind

> **kind**: [`NativeProcessResourceKind`](#nativeprocessresourcekind)

##### state

> **state**: `"unsupported"` \| `"captured"` \| `"recipe"` \| `"refused"`

##### fd?

> `optional` **fd?**: `number`

##### path?

> `optional` **path?**: `string`

##### flags?

> `optional` **flags?**: `string`[]

##### offset?

> `optional` **offset?**: `number`

##### recipe?

> `optional` **recipe?**: `Record`\<`string`, `unknown`\>

##### refusal?

> `optional` **refusal?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

***

### NativeProcessImageResources

#### Properties

##### formatVersion

> **formatVersion**: `1`

##### resources

> **resources**: [`NativeProcessResource`](#nativeprocessresource)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusals`](#nativeprocessimagerefusals)

***

### NativeCodeLocationMapping

#### Properties

##### id

> **id**: `string`

##### sourceMapping

> **sourceMapping**: `string`

##### sourceAddress

> **sourceAddress**: `string`

##### targetAddress?

> `optional` **targetAddress?**: `string`

##### state

> **state**: `"refused"` \| `"mapped"` \| `"pending"`

##### refusal?

> `optional` **refusal?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

***

### NativeThreadTranslation

#### Properties

##### sourceThreadId

> **sourceThreadId**: `string`

##### state

> **state**: `"refused"` \| `"pending"` \| `"translated"`

##### targetRegisters?

> `optional` **targetRegisters?**: [`NativeRegisterState`](#nativeregisterstate)

##### refusal?

> `optional` **refusal?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

***

### NativeMemoryRelocation

#### Properties

##### mapping

> **mapping**: `string`

##### offset

> **offset**: `number`

##### kind

> **kind**: `"pointer"` \| `"code-pointer"` \| `"return-address"` \| `"thread-pointer"`

##### sourceValue

> **sourceValue**: `string`

##### targetValue?

> `optional` **targetValue?**: `string`

##### state

> **state**: `"refused"` \| `"translated"` \| `"ambiguous"`

##### refusal?

> `optional` **refusal?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

***

### NativeProcessImageTranslation

#### Properties

##### formatVersion

> **formatVersion**: `1`

##### mode

> **mode**: `"native-cross-isa"`

##### sourceArch

> **sourceArch**: `"amd64"` \| `"arm64"`

##### targetArch

> **targetArch**: `"amd64"` \| `"arm64"`

##### codeLocations

> **codeLocations**: [`NativeCodeLocationMapping`](#nativecodelocationmapping)[]

##### threads

> **threads**: [`NativeThreadTranslation`](#nativethreadtranslation)[]

##### memoryRelocations

> **memoryRelocations**: [`NativeMemoryRelocation`](#nativememoryrelocation)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusals`](#nativeprocessimagerefusals)

***

### NativeProcessImageDocuments

#### Properties

##### rootDir?

> `optional` **rootDir?**: `string`

##### manifest

> **manifest**: [`NativeProcessImageManifest`](#nativeprocessimagemanifest)

##### mappings

> **mappings**: [`NativeProcessImageMappings`](#nativeprocessimagemappings)

##### threads

> **threads**: [`NativeProcessImageThreads`](#nativeprocessimagethreads)

##### resources

> **resources**: [`NativeProcessImageResources`](#nativeprocessimageresources)

##### translation

> **translation**: [`NativeProcessImageTranslation`](#nativeprocessimagetranslation)

***

### NativeProcessImageDocumentInput

#### Properties

##### rootDir?

> `optional` **rootDir?**: `string`

##### manifest

> **manifest**: `unknown`

##### mappings

> **mappings**: `unknown`

##### threads

> **threads**: `unknown`

##### resources

> **resources**: `unknown`

##### translation

> **translation**: `unknown`

***

### NativeRealUtilityExecutableRange

#### Properties

##### relativeStart

> **relativeStart**: `string`

##### relativeEnd

> **relativeEnd**: `string`

***

### NativeRealUtilitySourceModule

#### Extends

- [`NativeCodeModule`](#nativecodemodule)

#### Properties

##### id

> **id**: `string`

###### Inherited from

[`NativeCodeModule`](#nativecodemodule).[`id`](#id-1)

##### logicalName

> **logicalName**: `string`

###### Inherited from

[`NativeCodeModule`](#nativecodemodule).[`logicalName`](#logicalname)

##### path

> **path**: `string`

###### Inherited from

[`NativeCodeModule`](#nativecodemodule).[`path`](#path)

##### arch?

> `optional` **arch?**: `"amd64"` \| `"arm64"`

###### Inherited from

[`NativeCodeModule`](#nativecodemodule).[`arch`](#arch)

##### kind

> **kind**: `"unknown"` \| `"vdso"` \| `"executable"` \| `"pie-executable"` \| `"shared-object"`

###### Inherited from

[`NativeCodeModule`](#nativecodemodule).[`kind`](#kind-5)

##### buildId

> **buildId**: `string`

###### Inherited from

[`NativeCodeModule`](#nativecodemodule).[`buildId`](#buildid)

##### loadBias

> **loadBias**: `string`

###### Inherited from

[`NativeCodeModule`](#nativecodemodule).[`loadBias`](#loadbias)

##### textMapping

> **textMapping**: `string`

###### Inherited from

[`NativeCodeModule`](#nativecodemodule).[`textMapping`](#textmapping)

##### sourceStart

> **sourceStart**: `string`

##### sourceEnd

> **sourceEnd**: `string`

***

### NativeRealUtilityTargetSemanticContinuation

#### Properties

##### kind

> **kind**: [`NativeRealUtilityTargetContinuationKind`](#nativerealutilitytargetcontinuationkind)

##### source

> **source**: `"elf-symbol"`

##### symbolName

> **symbolName**: `string`

##### relativeAddress

> **relativeAddress**: `string`

##### sizeBytes?

> `optional` **sizeBytes?**: `number`

***

### NativeRealUtilityTargetModule

#### Extends

- [`NativeCodeModule`](#nativecodemodule)

#### Properties

##### id

> **id**: `string`

###### Inherited from

[`NativeCodeModule`](#nativecodemodule).[`id`](#id-1)

##### logicalName

> **logicalName**: `string`

###### Inherited from

[`NativeCodeModule`](#nativecodemodule).[`logicalName`](#logicalname)

##### path

> **path**: `string`

###### Inherited from

[`NativeCodeModule`](#nativecodemodule).[`path`](#path)

##### arch?

> `optional` **arch?**: `"amd64"` \| `"arm64"`

###### Inherited from

[`NativeCodeModule`](#nativecodemodule).[`arch`](#arch)

##### kind

> **kind**: `"unknown"` \| `"vdso"` \| `"executable"` \| `"pie-executable"` \| `"shared-object"`

###### Inherited from

[`NativeCodeModule`](#nativecodemodule).[`kind`](#kind-5)

##### buildId

> **buildId**: `string`

###### Inherited from

[`NativeCodeModule`](#nativecodemodule).[`buildId`](#buildid)

##### loadBias

> **loadBias**: `string`

###### Inherited from

[`NativeCodeModule`](#nativecodemodule).[`loadBias`](#loadbias)

##### textMapping

> **textMapping**: `string`

###### Inherited from

[`NativeCodeModule`](#nativecodemodule).[`textMapping`](#textmapping)

##### executable?

> `optional` **executable?**: `boolean`

##### executableRanges?

> `optional` **executableRanges?**: [`NativeRealUtilityExecutableRange`](#nativerealutilityexecutablerange)[]

##### semanticContinuations?

> `optional` **semanticContinuations?**: [`NativeRealUtilityTargetSemanticContinuation`](#nativerealutilitytargetsemanticcontinuation)[]

***

### NativeRealUtilityModuleExpectation

#### Properties

##### sourcePath?

> `optional` **sourcePath?**: `string`

##### sourceLogicalName?

> `optional` **sourceLogicalName?**: `string`

##### targetModuleId?

> `optional` **targetModuleId?**: `string`

##### targetPath?

> `optional` **targetPath?**: `string`

##### expectedTargetBuildId?

> `optional` **expectedTargetBuildId?**: `string`

***

### NativeRealUtilitySemanticContinuationSelection

#### Properties

##### kind

> **kind**: [`NativeRealUtilityTargetContinuationKind`](#nativerealutilitytargetcontinuationkind)

##### source

> **source**: `"elf-symbol"`

##### symbolName

> **symbolName**: `string`

##### targetRelativeAddress

> **targetRelativeAddress**: `string`

##### targetAddress

> **targetAddress**: `string`

##### sizeBytes?

> `optional` **sizeBytes?**: `number`

***

### NativeRealUtilityDeferredActiveSyscallLanding

#### Properties

##### threadId

> **threadId**: `string`

##### sourceAddress

> **sourceAddress**: `string`

##### sourceRva

> **sourceRva**: `string`

##### targetAddress

> **targetAddress**: `string`

##### targetRva

> **targetRva**: `string`

##### strategy

> **strategy**: `"synthetic-ppoll-syscall"` \| `"synthetic-sleep-syscall"` \| `"semantic-sleep-timer-symbol"`

##### syscallClass

> **syscallClass**: `"sleep-timer"` \| `"poll-timeout"`

##### action

> **action**: `"defer-target-resume"`

##### syscall

> **syscall**: `object`

###### state

> **state**: `"outside-syscall"` \| `"inside-syscall"` \| `"restart-block"`

###### number?

> `optional` **number?**: `number`

###### name?

> `optional` **name?**: `string`

###### arguments?

> `optional` **arguments?**: `string`[]

###### stackPointer?

> `optional` **stackPointer?**: `string`

###### instructionPointer?

> `optional` **instructionPointer?**: `string`

##### metadata

> **metadata**: \{ `remainingTime`: [`NativeModeledSleepTimerRemainingTime`](#nativemodeledsleeptimerremainingtime); `sleepTimer`: [`NativeModeledSleepTimerState`](#nativemodeledsleeptimerstate); `policy`: `"conservative-target-timer-rearm-required"`; \} \| \{ `remainingTime`: [`NativeModeledPpollTimeoutRemainingTime`](#nativemodeledppolltimeoutremainingtime); `ppollTimeout`: [`NativeModeledPpollTimeoutState`](#nativemodeledppolltimeoutstate); `policy`: `"conservative-target-ppoll-timeout-rearm-required"`; \}

##### semanticContinuation?

> `optional` **semanticContinuation?**: [`NativeRealUtilitySemanticContinuationSelection`](#nativerealutilitysemanticcontinuationselection)

##### syntheticContinuation?

> `optional` **syntheticContinuation?**: [`NativeRealUtilitySyntheticContinuationSelection`](#nativerealutilitysyntheticcontinuationselection)

***

### NativeRealUtilityResolvedLocation

#### Properties

##### threadId

> **threadId**: `string`

##### sourceModule

> **sourceModule**: [`NativeRealUtilitySourceModule`](#nativerealutilitysourcemodule)

##### targetModule

> **targetModule**: [`NativeRealUtilityTargetModule`](#nativerealutilitytargetmodule)

##### sourceRva

> **sourceRva**: `string`

##### targetRva

> **targetRva**: `string`

##### targetAddress

> **targetAddress**: `string`

##### continuationStrategy

> **continuationStrategy**: [`NativeRealUtilityContinuationStrategy`](#nativerealutilitycontinuationstrategy)

##### codeLocation

> **codeLocation**: [`NativeCodeLocationMapping`](#nativecodelocationmapping)

##### deferredActiveSyscallLanding?

> `optional` **deferredActiveSyscallLanding?**: [`NativeRealUtilityDeferredActiveSyscallLanding`](#nativerealutilitydeferredactivesyscalllanding)

##### semanticContinuation?

> `optional` **semanticContinuation?**: [`NativeRealUtilitySemanticContinuationSelection`](#nativerealutilitysemanticcontinuationselection)

##### syntheticContinuation?

> `optional` **syntheticContinuation?**: [`NativeRealUtilitySyntheticContinuationSelection`](#nativerealutilitysyntheticcontinuationselection)

***

### NativeRealUtilityCodeLocationRequest

#### Properties

##### documents

> **documents**: [`NativeProcessImageDocuments`](#nativeprocessimagedocuments)

##### targetArch

> **targetArch**: `"amd64"` \| `"arm64"`

##### targetModules

> **targetModules**: [`NativeRealUtilityTargetModule`](#nativerealutilitytargetmodule)[]

##### moduleExpectations?

> `optional` **moduleExpectations?**: [`NativeRealUtilityModuleExpectation`](#nativerealutilitymoduleexpectation)[]

##### threadIds?

> `optional` **threadIds?**: `string`[]

##### activeSyscallContinuations?

> `optional` **activeSyscallContinuations?**: [`NativeActiveSyscallContinuation`](#nativeactivesyscallcontinuation)[]

##### sleepTimerContinuationStrategy?

> `optional` **sleepTimerContinuationStrategy?**: `"synthetic-syscall"` \| `"target-symbol"`

##### pollTimeoutContinuationStrategy?

> `optional` **pollTimeoutContinuationStrategy?**: `"refuse"` \| `"synthetic-syscall"`

##### syntheticSleepBaseAddress?

> `optional` **syntheticSleepBaseAddress?**: `string`

##### syntheticPpollBaseAddress?

> `optional` **syntheticPpollBaseAddress?**: `string`

##### syntheticSleepCompletionMode?

> `optional` **syntheticSleepCompletionMode?**: [`NativeSyntheticSleepCompletionMode`](#nativesyntheticsleepcompletionmode)

##### syntheticPpollCompletionMode?

> `optional` **syntheticPpollCompletionMode?**: [`NativeSyntheticPpollCompletionMode`](#nativesyntheticppollcompletionmode)

***

### NativeRealUtilityCodeLocationResult

#### Properties

##### sourceModules

> **sourceModules**: [`NativeRealUtilitySourceModule`](#nativerealutilitysourcemodule)[]

##### targetModules

> **targetModules**: [`NativeRealUtilityTargetModule`](#nativerealutilitytargetmodule)[]

##### resolved

> **resolved**: [`NativeRealUtilityResolvedLocation`](#nativerealutilityresolvedlocation)[]

##### codeLocations

> **codeLocations**: [`NativeCodeLocationMapping`](#nativecodelocationmapping)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeRealUtilityContinuationRequest

#### Extended by

- [`NativeActualRealUtilityContinuationRequest`](#nativeactualrealutilitycontinuationrequest)

#### Properties

##### threadRefusals?

> `optional` **threadRefusals?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

##### resourceRefusals?

> `optional` **resourceRefusals?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

##### mappingRefusals?

> `optional` **mappingRefusals?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

##### codeLocations

> **codeLocations**: [`NativeCodeLocationMapping`](#nativecodelocationmapping)[]

##### sourceFrames

> **sourceFrames**: [`NativeDiscoveredUnwindFrame`](#nativediscoveredunwindframe)[]

##### sourceFrameRefusals?

> `optional` **sourceFrameRefusals?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

##### sourceUnwindRequired?

> `optional` **sourceUnwindRequired?**: `boolean`

##### targetUnwind?

> `optional` **targetUnwind?**: [`NativeTargetUnwindMatchResult`](#nativetargetunwindmatchresult)

##### targetUnwindMatched?

> `optional` **targetUnwindMatched?**: `boolean`

##### targetFrameState?

> `optional` **targetFrameState?**: [`NativeTargetFrameStateMaterializationResult`](#nativetargetframestatematerializationresult)

##### targetFrameStateMaterialized?

> `optional` **targetFrameStateMaterialized?**: `boolean`

***

### NativeRealUtilityContinuationPlan

#### Properties

##### state

> **state**: `"refused"` \| `"ready"`

##### blockingBoundary

> **blockingBoundary**: [`NativeRealUtilityContinuationBoundary`](#nativerealutilitycontinuationboundary)

##### blockingRefusal?

> `optional` **blockingRefusal?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

##### attemptedResume

> **attemptedResume**: `false`

##### sourceTextReusedAsTargetCode

> **sourceTextReusedAsTargetCode**: `false`

##### sourceIsaEmulationUsed

> **sourceIsaEmulationUsed**: `false`

##### sidecarRuntimeUsed

> **sidecarRuntimeUsed**: `false`

***

### NativeRegisterTranslationRequest

#### Properties

##### sourceArch

> **sourceArch**: `"amd64"` \| `"arm64"`

##### targetArch

> **targetArch**: `"amd64"` \| `"arm64"`

##### threads

> **threads**: [`NativeThreadState`](#nativethreadstate)[]

##### continuations

> **continuations**: `Record`\<`string`, [`NativeContinuationTarget`](#nativecontinuationtarget)\>

***

### NativeContinuationTarget

#### Properties

##### sourcePc

> **sourcePc**: `string`

##### targetIp

> **targetIp**: `string`

##### targetSp

> **targetSp**: `string`

##### targetTls

> **targetTls**: `string`

##### targetTlsAccessPolicy?

> `optional` **targetTlsAccessPolicy?**: [`NativeTlsTargetAccessPolicy`](#nativetlstargetaccesspolicy)

##### targetRegisterOverrides?

> `optional` **targetRegisterOverrides?**: `Partial`\<`Pick`\<[`NativeAmd64Registers`](#nativeamd64registers), `"rax"` \| `"rbx"` \| `"rcx"` \| `"rdx"` \| `"rsi"` \| `"rdi"` \| `"rbp"` \| `"r8"` \| `"r9"` \| `"r10"` \| `"r11"` \| `"r12"` \| `"r13"` \| `"r14"` \| `"r15"`\>\>

***

### NativeRegisterTranslationResult

#### Properties

##### sourceArch

> **sourceArch**: `"amd64"` \| `"arm64"`

##### targetArch

> **targetArch**: `"amd64"` \| `"arm64"`

##### threads

> **threads**: [`NativeThreadTranslation`](#nativethreadtranslation)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeInheritedStdioPolicy

#### Properties

##### mode

> **mode**: `"inherit-output"` \| `"require-explicit"`

***

### NativeResourceTranslationRequest

#### Extended by

- [`NativeTargetFdTablePlanRequest`](#nativetargetfdtableplanrequest)

#### Properties

##### resources

> **resources**: [`NativeProcessResource`](#nativeprocessresource)[]

##### hostCapabilities?

> `optional` **hostCapabilities?**: `string`[]

##### inheritedStdio?

> `optional` **inheritedStdio?**: [`NativeInheritedStdioPolicy`](#nativeinheritedstdiopolicy)

##### syntheticEmptyPipeFds?

> `optional` **syntheticEmptyPipeFds?**: `number`[]

##### syntheticEmptyEventFds?

> `optional` **syntheticEmptyEventFds?**: `number`[]

##### syntheticTimerFds?

> `optional` **syntheticTimerFds?**: `number`[]

***

### NativeResourceTranslationResult

#### Properties

##### resources

> **resources**: [`NativeProcessResource`](#nativeprocessresource)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeTargetFdTableEntry

#### Properties

##### targetFd

> **targetFd**: `number`

##### capturedFd?

> `optional` **capturedFd?**: `number`

##### resourceId?

> `optional` **resourceId?**: `string`

##### resourceKind?

> `optional` **resourceKind?**: [`NativeProcessResourceKind`](#nativeprocessresourcekind)

##### kind

> **kind**: [`NativeTargetFdTableEntryKind`](#nativetargetfdtableentrykind)

##### closeOnExec

> **closeOnExec**: `boolean`

##### action

> **action**: `"close"` \| `"refuse"` \| `"materialize"`

##### source

> **source**: `"captured-resource"` \| `"missing-captured-fd"`

##### recipe?

> `optional` **recipe?**: `Record`\<`string`, `unknown`\>

##### targetGuestRecipe?

> `optional` **targetGuestRecipe?**: [`TargetGuestRestoreResourceRecipe`](#targetguestrestoreresourcerecipe)

##### refusal?

> `optional` **refusal?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

##### provenance

> **provenance**: `object`

###### resourceId?

> `optional` **resourceId?**: `string`

###### capturedFd?

> `optional` **capturedFd?**: `number`

###### targetFd

> **targetFd**: `number`

###### flags?

> `optional` **flags?**: `string`[]

###### reason

> **reason**: `string`

***

### NativeTargetFdTablePlanRequest

#### Extends

- [`NativeResourceTranslationRequest`](#nativeresourcetranslationrequest)

#### Properties

##### resources

> **resources**: [`NativeProcessResource`](#nativeprocessresource)[]

###### Inherited from

[`NativeResourceTranslationRequest`](#nativeresourcetranslationrequest).[`resources`](#resources-5)

##### hostCapabilities?

> `optional` **hostCapabilities?**: `string`[]

###### Inherited from

[`NativeResourceTranslationRequest`](#nativeresourcetranslationrequest).[`hostCapabilities`](#hostcapabilities)

##### inheritedStdio?

> `optional` **inheritedStdio?**: [`NativeInheritedStdioPolicy`](#nativeinheritedstdiopolicy)

###### Inherited from

[`NativeResourceTranslationRequest`](#nativeresourcetranslationrequest).[`inheritedStdio`](#inheritedstdio)

##### syntheticEmptyPipeFds?

> `optional` **syntheticEmptyPipeFds?**: `number`[]

###### Inherited from

[`NativeResourceTranslationRequest`](#nativeresourcetranslationrequest).[`syntheticEmptyPipeFds`](#syntheticemptypipefds)

##### syntheticEmptyEventFds?

> `optional` **syntheticEmptyEventFds?**: `number`[]

###### Inherited from

[`NativeResourceTranslationRequest`](#nativeresourcetranslationrequest).[`syntheticEmptyEventFds`](#syntheticemptyeventfds)

##### syntheticTimerFds?

> `optional` **syntheticTimerFds?**: `number`[]

###### Inherited from

[`NativeResourceTranslationRequest`](#nativeresourcetranslationrequest).[`syntheticTimerFds`](#synthetictimerfds)

##### expectedFds?

> `optional` **expectedFds?**: `number`[]

***

### NativeTargetFdTablePlan

#### Properties

##### entries

> **entries**: [`NativeTargetFdTableEntry`](#nativetargetfdtableentry)[]

##### resources

> **resources**: [`NativeProcessResource`](#nativeprocessresource)[]

##### targetGuestResources

> **targetGuestResources**: [`TargetGuestRestoreResourceRecipe`](#targetguestrestoreresourcerecipe)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeReturnChainFrame

#### Extended by

- [`NativeReturnChainPlanFrame`](#nativereturnchainplanframe)

#### Properties

##### id

> **id**: `string`

##### framePointer

> **framePointer**: `string`

##### canonicalFrameAddress

> **canonicalFrameAddress**: `string`

##### returnAddressSlot

> **returnAddressSlot**: `string`

##### returnAddress

> **returnAddress**: `string`

##### unwindId

> **unwindId**: `string`

##### callerFramePointer?

> `optional` **callerFramePointer?**: `string`

***

### NativeReturnChainPlanRequest

#### Properties

##### targetStackBase

> **targetStackBase**: `string`

##### targetStackLimit

> **targetStackLimit**: `string`

##### maxFrames

> **maxFrames**: `number`

##### frames

> **frames**: [`NativeReturnChainFrame`](#nativereturnchainframe)[]

***

### NativeReturnChainPlanFrame

#### Extends

- [`NativeReturnChainFrame`](#nativereturnchainframe)

#### Properties

##### id

> **id**: `string`

###### Inherited from

[`NativeReturnChainFrame`](#nativereturnchainframe).[`id`](#id-10)

##### unwindId

> **unwindId**: `string`

###### Inherited from

[`NativeReturnChainFrame`](#nativereturnchainframe).[`unwindId`](#unwindid)

##### index

> **index**: `number`

##### framePointer

> **framePointer**: `string`

###### Overrides

[`NativeReturnChainFrame`](#nativereturnchainframe).[`framePointer`](#framepointer)

##### canonicalFrameAddress

> **canonicalFrameAddress**: `string`

###### Overrides

[`NativeReturnChainFrame`](#nativereturnchainframe).[`canonicalFrameAddress`](#canonicalframeaddress)

##### returnAddressSlot

> **returnAddressSlot**: `string`

###### Overrides

[`NativeReturnChainFrame`](#nativereturnchainframe).[`returnAddressSlot`](#returnaddressslot)

##### returnAddress

> **returnAddress**: `string`

###### Overrides

[`NativeReturnChainFrame`](#nativereturnchainframe).[`returnAddress`](#returnaddress)

##### callerFramePointer?

> `optional` **callerFramePointer?**: `string`

###### Overrides

[`NativeReturnChainFrame`](#nativereturnchainframe).[`callerFramePointer`](#callerframepointer)

***

### NativeReturnChainPlan

#### Properties

##### state

> **state**: `"refused"` \| `"materialized"`

##### targetStack

> **targetStack**: `object`

###### base

> **base**: `string`

###### limit

> **limit**: `string`

##### frames

> **frames**: [`NativeReturnChainPlanFrame`](#nativereturnchainplanframe)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeSimdFpuLiveSubsetPolicy

#### Properties

##### state

> **state**: `"refuse-all-live-subsets"`

##### acceptedSubsets

> **acceptedSubsets**: \[\]

##### refusalCode

> **refusalCode**: `"simd-fpu-state-unsupported"`

##### reason

> **reason**: `string`

***

### NativeStackFrame

#### Properties

##### id

> **id**: `string`

##### sourceSp

> **sourceSp**: `string`

##### sourceReturnAddress

> **sourceReturnAddress**: `string`

##### sizeBytes

> **sizeBytes**: `number`

##### metadata

> **metadata**: `"unknown"` \| `"dwarf"` \| `"sidecar"`

##### locals

> **locals**: [`NativeStackSlot`](#nativestackslot)[]

***

### NativeStackSlot

#### Properties

##### offset

> **offset**: `number`

##### kind

> **kind**: `"pointer"` \| `"code-pointer"` \| `"ambiguous"` \| `"integer"`

##### sourceValue

> **sourceValue**: `string`

##### targetValue?

> `optional` **targetValue?**: `string`

***

### NativeStackTranslationRequest

#### Extended by

- [`NativeStackWindowMaterializationRequest`](#nativestackwindowmaterializationrequest)

#### Properties

##### stackMapping

> **stackMapping**: `string`

##### targetStackBase

> **targetStackBase**: `string`

##### frames

> **frames**: [`NativeStackFrame`](#nativestackframe)[]

##### codeLocations

> **codeLocations**: [`NativeCodeLocationMapping`](#nativecodelocationmapping)[]

***

### NativeStackTranslationResult

#### Properties

##### stackMapping

> **stackMapping**: `string`

##### targetStackBase

> **targetStackBase**: `string`

##### targetStackSizeBytes

> **targetStackSizeBytes**: `number`

##### relocations

> **relocations**: [`NativeMemoryRelocation`](#nativememoryrelocation)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeStackPointerRange

#### Properties

##### id

> **id**: `string`

##### targetBase

> **targetBase**: `string`

##### targetLimit

> **targetLimit**: `string`

***

### NativeStackWindowMaterializationRequest

#### Extends

- [`NativeStackTranslationRequest`](#nativestacktranslationrequest)

#### Properties

##### stackMapping

> **stackMapping**: `string`

###### Inherited from

[`NativeStackTranslationRequest`](#nativestacktranslationrequest).[`stackMapping`](#stackmapping-1)

##### targetStackBase

> **targetStackBase**: `string`

###### Inherited from

[`NativeStackTranslationRequest`](#nativestacktranslationrequest).[`targetStackBase`](#targetstackbase-1)

##### frames

> **frames**: [`NativeStackFrame`](#nativestackframe)[]

###### Inherited from

[`NativeStackTranslationRequest`](#nativestacktranslationrequest).[`frames`](#frames-2)

##### codeLocations

> **codeLocations**: [`NativeCodeLocationMapping`](#nativecodelocationmapping)[]

###### Inherited from

[`NativeStackTranslationRequest`](#nativestacktranslationrequest).[`codeLocations`](#codelocations-6)

##### sourceStackBase

> **sourceStackBase**: `string`

##### sourceStackLimit

> **sourceStackLimit**: `string`

##### targetStackLimit

> **targetStackLimit**: `string`

##### guardBelowAddress

> **guardBelowAddress**: `string`

##### guardAboveAddress

> **guardAboveAddress**: `string`

##### pointerRanges

> **pointerRanges**: [`NativeStackPointerRange`](#nativestackpointerrange)[]

***

### NativeStackWindowMaterializationPlan

#### Properties

##### state

> **state**: `"refused"` \| `"materialized"`

##### stackMapping

> **stackMapping**: `string`

##### sourceWindow

> **sourceWindow**: `object`

###### base

> **base**: `string`

###### limit

> **limit**: `string`

##### targetWindow

> **targetWindow**: `object`

###### base

> **base**: `string`

###### limit

> **limit**: `string`

###### sizeBytes

> **sizeBytes**: `number`

##### guards

> **guards**: `object`

###### below

> **below**: `string`

###### above

> **above**: `string`

##### relocations

> **relocations**: [`NativeMemoryRelocation`](#nativememoryrelocation)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeSyntheticSyscallArgumentDescriptor

#### Extended by

- [`NativeSyntheticPpollSyscallArgumentProvenance`](#nativesyntheticppollsyscallargumentprovenance)
- [`NativeSyntheticSleepSyscallArgumentProvenance`](#nativesyntheticsleepsyscallargumentprovenance)

#### Properties

##### register

> **register**: [`NativeSyntheticContinuationRegister`](#nativesyntheticcontinuationregister)

##### role

> **role**: `string`

##### value

> **value**: `string`

##### source

> **source**: [`NativeSyntheticContinuationProvenanceSource`](#nativesyntheticcontinuationprovenancesource)

***

### NativeSyntheticSyscallDescriptor

#### Properties

##### abi

> **abi**: `"linux-amd64"`

##### name

> **name**: `string`

##### number

> **number**: `number`

##### arguments

> **arguments**: [`NativeSyntheticSyscallArgumentDescriptor`](#nativesyntheticsyscallargumentdescriptor)[]

***

### NativeSyntheticContinuationRegisterSetupDescriptor

#### Extended by

- [`NativeSyntheticPpollSyscallRegisterSetupProvenance`](#nativesyntheticppollsyscallregistersetupprovenance)
- [`NativeSyntheticSleepSyscallRegisterSetupProvenance`](#nativesyntheticsleepsyscallregistersetupprovenance)

#### Properties

##### abi

> **abi**: `"linux-amd64-syscall"`

##### arguments

> **arguments**: [`NativeSyntheticSyscallArgumentDescriptor`](#nativesyntheticsyscallargumentdescriptor)[]

##### clobberedBySyscall

> **clobberedBySyscall**: [`NativeSyntheticContinuationRegister`](#nativesyntheticcontinuationregister)[]

##### notes

> **notes**: `string`[]

***

### NativeSyntheticContinuationStackSetupDescriptor

#### Extended by

- [`NativeSyntheticPpollSyscallStackSetupProvenance`](#nativesyntheticppollsyscallstacksetupprovenance)
- [`NativeSyntheticSleepSyscallStackSetupProvenance`](#nativesyntheticsleepsyscallstacksetupprovenance)

#### Properties

##### entryStackPointer

> **entryStackPointer**: `string`

##### stackBytesWrittenByContinuation

> **stackBytesWrittenByContinuation**: `number`

##### returnAddress

> **returnAddress**: `string`

##### requiresSourceStackBytes

> **requiresSourceStackBytes**: `boolean`

***

### NativeSyntheticContinuationFailureExitBucket

#### Properties

##### exitStatus

> **exitStatus**: `number`

##### failureKind

> **failureKind**: [`NativeSyntheticContinuationFailureKind`](#nativesyntheticcontinuationfailurekind)

##### failureReason

> **failureReason**: `string`

##### syscallReturn

> **syscallReturn**: `object`

###### register

> **register**: `"rax"`

###### condition

> **condition**: [`NativeSyntheticContinuationFailureExitBucketCondition`](#nativesyntheticcontinuationfailureexitbucketcondition)

###### errno?

> `optional` **errno?**: `number`

###### errnoName?

> `optional` **errnoName?**: `string`

###### errnos?

> `optional` **errnos?**: `object`[]

###### errnoRange?

> `optional` **errnoRange?**: `object`

###### errnoRange.min

> **min**: `number`

###### errnoRange.max

> **max**: `number`

###### excludedErrnos?

> `optional` **excludedErrnos?**: `object`[]

***

### NativeSyntheticContinuationRestartContract

#### Properties

##### mode

> **mode**: `"fail-closed"`

##### signalMaskAssumption

> **signalMaskAssumption**: `"source-sigmask-null-or-unmodeled"`

##### pendingSignalAssumption

> **pendingSignalAssumption**: `"no-pending-signal-state-modeled"`

##### plainEintr

> **plainEintr**: `"refuse"`

##### restartLikeErrnos

> **restartLikeErrnos**: `object`[]

###### errno

> **errno**: `number`

###### errnoName

> **errnoName**: `string`

##### targetRestartRequirements

> **targetRestartRequirements**: `string`[]

***

### NativeSyntheticContinuationCompletionDescriptor

#### Extended by

- [`NativeSyntheticPpollSyscallCompletionProvenance`](#nativesyntheticppollsyscallcompletionprovenance)
- [`NativeSyntheticSleepSyscallCompletionProvenance`](#nativesyntheticsleepsyscallcompletionprovenance)

#### Properties

##### mode

> **mode**: `string`

##### successExitStatus?

> `optional` **successExitStatus?**: `number`

##### restartContract?

> `optional` **restartContract?**: [`NativeSyntheticContinuationRestartContract`](#nativesyntheticcontinuationrestartcontract)

##### failureExitStatus?

> `optional` **failureExitStatus?**: `number`

Legacy single-bucket failure status. Prefer failureExitBuckets for new continuations.

##### failureKind?

> `optional` **failureKind?**: [`NativeSyntheticContinuationFailureKind`](#nativesyntheticcontinuationfailurekind)

Legacy single-bucket failure kind. Prefer failureExitBuckets for new continuations.

##### failureReason?

> `optional` **failureReason?**: `string`

Legacy single-bucket failure reason. Prefer failureExitBuckets for new continuations.

##### failureExitBuckets?

> `optional` **failureExitBuckets?**: [`NativeSyntheticContinuationFailureExitBucket`](#nativesyntheticcontinuationfailureexitbucket)[]

***

### NativeSyntheticSyscallContinuationDescriptorRequest

#### Properties

##### targetArch

> **targetArch**: `"amd64"`

##### entryAddress

> **entryAddress**: `string`

##### relativeAddress

> **relativeAddress**: `string`

##### generatorBuildId

> **generatorBuildId**: `string`

##### bytes

> **bytes**: `Uint8Array`

##### syscall

> **syscall**: `Omit`\<[`NativeSyntheticSyscallDescriptor`](#nativesyntheticsyscalldescriptor), `"abi"`\>

##### registerSetup

> **registerSetup**: [`NativeSyntheticContinuationRegisterSetupDescriptor`](#nativesyntheticcontinuationregistersetupdescriptor)

##### stackSetup

> **stackSetup**: [`NativeSyntheticContinuationStackSetupDescriptor`](#nativesyntheticcontinuationstacksetupdescriptor)

##### completion

> **completion**: [`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor)

***

### NativeSyntheticSyscallContinuationDescriptor

#### Extended by

- [`NativeSyntheticPpollSyscallContinuationProvenance`](#nativesyntheticppollsyscallcontinuationprovenance)
- [`NativeSyntheticSleepSyscallContinuationProvenance`](#nativesyntheticsleepsyscallcontinuationprovenance)

#### Properties

##### kind

> **kind**: `"synthetic-syscall-continuation"`

##### targetArch

> **targetArch**: `"amd64"`

##### entryAddress

> **entryAddress**: `string`

##### relativeAddress

> **relativeAddress**: `string`

##### byteSource

> **byteSource**: `"generated-target-native-amd64-syscall-sequence"`

##### generatorBuildId

> **generatorBuildId**: `string`

##### byteEncoding

> **byteEncoding**: `"amd64-machine-code"`

##### sizeBytes

> **sizeBytes**: `number`

##### bytesHex

> **bytesHex**: `string`

##### byteSha256

> **byteSha256**: `string`

##### descriptorSha256

> **descriptorSha256**: `string`

##### generatedTargetBytes

> **generatedTargetBytes**: `true`

##### sourceTextReusedAsTargetCode

> **sourceTextReusedAsTargetCode**: `false`

##### sourceIsaEmulationUsed

> **sourceIsaEmulationUsed**: `false`

##### sidecarRuntimeUsed

> **sidecarRuntimeUsed**: `false`

##### syscallAbi

> **syscallAbi**: `"linux-amd64"`

##### syscall

> **syscall**: [`NativeSyntheticSyscallDescriptor`](#nativesyntheticsyscalldescriptor)

##### registerSetup

> **registerSetup**: [`NativeSyntheticContinuationRegisterSetupDescriptor`](#nativesyntheticcontinuationregistersetupdescriptor)

##### stackSetup

> **stackSetup**: [`NativeSyntheticContinuationStackSetupDescriptor`](#nativesyntheticcontinuationstacksetupdescriptor)

##### completion

> **completion**: [`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor)

***

### NativeSyntheticPpollSyscallArgumentProvenance

#### Extends

- [`NativeSyntheticSyscallArgumentDescriptor`](#nativesyntheticsyscallargumentdescriptor)

#### Properties

##### value

> **value**: `string`

###### Inherited from

[`NativeSyntheticSyscallArgumentDescriptor`](#nativesyntheticsyscallargumentdescriptor).[`value`](#value)

##### register

> **register**: `"rax"` \| `"rdx"` \| `"rsi"` \| `"rdi"` \| `"r8"` \| `"r10"`

###### Overrides

[`NativeSyntheticSyscallArgumentDescriptor`](#nativesyntheticsyscallargumentdescriptor).[`register`](#register)

##### role

> **role**: `"nfds"` \| `"syscall-number"` \| `"fds-pointer"` \| `"timeout-timespec-pointer"` \| `"sigmask-pointer"` \| `"sigset-size"`

###### Overrides

[`NativeSyntheticSyscallArgumentDescriptor`](#nativesyntheticsyscallargumentdescriptor).[`role`](#role)

##### source

> **source**: [`NativeSyntheticContinuationProvenanceSource`](#nativesyntheticcontinuationprovenancesource)

###### Overrides

[`NativeSyntheticSyscallArgumentDescriptor`](#nativesyntheticsyscallargumentdescriptor).[`source`](#source-7)

***

### NativeSyntheticPpollSyscallRegisterSetupProvenance

#### Extends

- [`NativeSyntheticContinuationRegisterSetupDescriptor`](#nativesyntheticcontinuationregistersetupdescriptor)

#### Properties

##### abi

> **abi**: `"linux-amd64-syscall"`

###### Inherited from

[`NativeSyntheticContinuationRegisterSetupDescriptor`](#nativesyntheticcontinuationregistersetupdescriptor).[`abi`](#abi-1)

##### notes

> **notes**: `string`[]

###### Inherited from

[`NativeSyntheticContinuationRegisterSetupDescriptor`](#nativesyntheticcontinuationregistersetupdescriptor).[`notes`](#notes)

##### arguments

> **arguments**: [`NativeSyntheticPpollSyscallArgumentProvenance`](#nativesyntheticppollsyscallargumentprovenance)[]

###### Overrides

[`NativeSyntheticContinuationRegisterSetupDescriptor`](#nativesyntheticcontinuationregistersetupdescriptor).[`arguments`](#arguments-1)

##### clobberedBySyscall

> **clobberedBySyscall**: \[`"rax"`, `"rcx"`, `"r11"`\]

###### Overrides

[`NativeSyntheticContinuationRegisterSetupDescriptor`](#nativesyntheticcontinuationregistersetupdescriptor).[`clobberedBySyscall`](#clobberedbysyscall)

***

### NativeSyntheticPpollSyscallStackSetupProvenance

#### Extends

- [`NativeSyntheticContinuationStackSetupDescriptor`](#nativesyntheticcontinuationstacksetupdescriptor)

#### Properties

##### entryStackPointer

> **entryStackPointer**: `"target-caller-frame-stack-pointer"`

###### Overrides

[`NativeSyntheticContinuationStackSetupDescriptor`](#nativesyntheticcontinuationstacksetupdescriptor).[`entryStackPointer`](#entrystackpointer)

##### stackBytesWrittenByContinuation

> **stackBytesWrittenByContinuation**: `0`

###### Overrides

[`NativeSyntheticContinuationStackSetupDescriptor`](#nativesyntheticcontinuationstacksetupdescriptor).[`stackBytesWrittenByContinuation`](#stackbyteswrittenbycontinuation)

##### returnAddress

> **returnAddress**: `"not-used-exit-process-completion"` \| `"trampoline-sentinel-return-address"`

###### Overrides

[`NativeSyntheticContinuationStackSetupDescriptor`](#nativesyntheticcontinuationstacksetupdescriptor).[`returnAddress`](#returnaddress-2)

##### requiresSourceStackBytes

> **requiresSourceStackBytes**: `false`

###### Overrides

[`NativeSyntheticContinuationStackSetupDescriptor`](#nativesyntheticcontinuationstacksetupdescriptor).[`requiresSourceStackBytes`](#requiressourcestackbytes)

***

### NativeSyntheticPpollSyscallCompletionProvenance

#### Extends

- [`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor)

#### Properties

##### restartContract?

> `optional` **restartContract?**: [`NativeSyntheticContinuationRestartContract`](#nativesyntheticcontinuationrestartcontract)

###### Inherited from

[`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor).[`restartContract`](#restartcontract)

##### failureExitStatus?

> `optional` **failureExitStatus?**: `number`

Legacy single-bucket failure status. Prefer failureExitBuckets for new continuations.

###### Inherited from

[`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor).[`failureExitStatus`](#failureexitstatus)

##### failureKind?

> `optional` **failureKind?**: [`NativeSyntheticContinuationFailureKind`](#nativesyntheticcontinuationfailurekind)

Legacy single-bucket failure kind. Prefer failureExitBuckets for new continuations.

###### Inherited from

[`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor).[`failureKind`](#failurekind-1)

##### failureReason?

> `optional` **failureReason?**: `string`

Legacy single-bucket failure reason. Prefer failureExitBuckets for new continuations.

###### Inherited from

[`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor).[`failureReason`](#failurereason-1)

##### mode

> **mode**: [`NativeSyntheticPpollCompletionMode`](#nativesyntheticppollcompletionmode)

###### Overrides

[`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor).[`mode`](#mode-3)

##### successExitStatus?

> `optional` **successExitStatus?**: `0`

###### Overrides

[`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor).[`successExitStatus`](#successexitstatus)

##### failureExitBuckets?

> `optional` **failureExitBuckets?**: [`NativeSyntheticContinuationFailureExitBucket`](#nativesyntheticcontinuationfailureexitbucket)[]

###### Overrides

[`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor).[`failureExitBuckets`](#failureexitbuckets)

***

### NativeSyntheticPpollSyscallContinuationProvenance

#### Extends

- [`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor)

#### Properties

##### kind

> **kind**: `"synthetic-syscall-continuation"`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`kind`](#kind-17)

##### targetArch

> **targetArch**: `"amd64"`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`targetArch`](#targetarch-6)

##### entryAddress

> **entryAddress**: `string`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`entryAddress`](#entryaddress-1)

##### relativeAddress

> **relativeAddress**: `string`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`relativeAddress`](#relativeaddress-3)

##### byteSource

> **byteSource**: `"generated-target-native-amd64-syscall-sequence"`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`byteSource`](#bytesource)

##### byteEncoding

> **byteEncoding**: `"amd64-machine-code"`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`byteEncoding`](#byteencoding)

##### sizeBytes

> **sizeBytes**: `number`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`sizeBytes`](#sizebytes-9)

##### bytesHex

> **bytesHex**: `string`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`bytesHex`](#byteshex)

##### byteSha256

> **byteSha256**: `string`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`byteSha256`](#bytesha256)

##### descriptorSha256

> **descriptorSha256**: `string`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`descriptorSha256`](#descriptorsha256)

##### generatedTargetBytes

> **generatedTargetBytes**: `true`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`generatedTargetBytes`](#generatedtargetbytes)

##### sourceTextReusedAsTargetCode

> **sourceTextReusedAsTargetCode**: `false`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`sourceTextReusedAsTargetCode`](#sourcetextreusedastargetcode-2)

##### sourceIsaEmulationUsed

> **sourceIsaEmulationUsed**: `false`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`sourceIsaEmulationUsed`](#sourceisaemulationused-2)

##### sidecarRuntimeUsed

> **sidecarRuntimeUsed**: `false`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`sidecarRuntimeUsed`](#sidecarruntimeused-2)

##### syscallAbi

> **syscallAbi**: `"linux-amd64"`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`syscallAbi`](#syscallabi)

##### generatorBuildId

> **generatorBuildId**: `"machinen-synthetic-ppoll-syscall-v2"`

###### Overrides

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`generatorBuildId`](#generatorbuildid-1)

##### syscall

> **syscall**: [`NativeSyntheticSyscallDescriptor`](#nativesyntheticsyscalldescriptor) & `object`

###### Type Declaration

###### name

> **name**: `"ppoll"`

###### number

> **number**: `271`

###### arguments

> **arguments**: [`NativeSyntheticPpollSyscallArgumentProvenance`](#nativesyntheticppollsyscallargumentprovenance)[]

###### Overrides

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`syscall`](#syscall-5)

##### embeddedData

> **embeddedData**: `object`

###### kind

> **kind**: `"timespec"`

###### offset

> **offset**: `number`

###### seconds

> **seconds**: `string`

###### nanoseconds

> **nanoseconds**: `number`

###### byteOrder

> **byteOrder**: `"little-endian"`

###### pointerRegister

> **pointerRegister**: `"rdx"`

###### pointerEncoding

> **pointerEncoding**: `"rip-relative"`

##### embeddedPollFds?

> `optional` **embeddedPollFds?**: `object`

###### kind

> **kind**: `"pollfd-array"`

###### offset

> **offset**: `number`

###### entries

> **entries**: [`NativeModeledPpollFdState`](#nativemodeledppollfdstate)[]

###### byteOrder

> **byteOrder**: `"little-endian"`

###### pointerRegister

> **pointerRegister**: `"rdi"`

###### pointerEncoding

> **pointerEncoding**: `"stack-relative"`

##### registerSetup

> **registerSetup**: [`NativeSyntheticPpollSyscallRegisterSetupProvenance`](#nativesyntheticppollsyscallregistersetupprovenance)

###### Overrides

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`registerSetup`](#registersetup-1)

##### stackSetup

> **stackSetup**: [`NativeSyntheticPpollSyscallStackSetupProvenance`](#nativesyntheticppollsyscallstacksetupprovenance)

###### Overrides

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`stackSetup`](#stacksetup-1)

##### completion

> **completion**: [`NativeSyntheticPpollSyscallCompletionProvenance`](#nativesyntheticppollsyscallcompletionprovenance)

###### Overrides

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`completion`](#completion-1)

***

### NativeSyntheticPpollSyscallContinuationRequest

#### Properties

##### threadId

> **threadId**: `string`

##### remainingTime

> **remainingTime**: [`NativeModeledPpollTimeoutRemainingTime`](#nativemodeledppolltimeoutremainingtime)

##### ppollTimeout?

> `optional` **ppollTimeout?**: [`NativeModeledPpollTimeoutState`](#nativemodeledppolltimeoutstate)

##### targetAddress?

> `optional` **targetAddress?**: `string`

##### completionMode?

> `optional` **completionMode?**: [`NativeSyntheticPpollCompletionMode`](#nativesyntheticppollcompletionmode)

***

### NativeSyntheticPpollSyscallContinuation

#### Properties

##### kind

> **kind**: `"synthetic-ppoll-syscall"`

##### threadId

> **threadId**: `string`

##### targetArch

> **targetArch**: `"amd64"`

##### entryAddress

> **entryAddress**: `string`

##### relativeAddress

> **relativeAddress**: `"0x0"`

##### syscall

> **syscall**: `object`

###### name

> **name**: `"ppoll"`

###### number

> **number**: `271`

###### fdsPointer

> **fdsPointer**: `"0x0"` \| `"stack-relative-pollfd-array"`

###### nfds

> **nfds**: `0` \| `1`

###### pollFds?

> `optional` **pollFds?**: [`NativeModeledPpollFdState`](#nativemodeledppollfdstate)[]

###### timeoutPointerEncoding

> **timeoutPointerEncoding**: `"rip-relative-timespec"`

###### sigmaskPointer

> **sigmaskPointer**: `"0x0"`

###### sigsetSize

> **sigsetSize**: `0`

##### remainingTime

> **remainingTime**: [`NativeModeledPpollTimeoutRemainingTime`](#nativemodeledppolltimeoutremainingtime)

##### completionMode

> **completionMode**: [`NativeSyntheticPpollCompletionMode`](#nativesyntheticppollcompletionmode)

##### exitStatusOnSuccess?

> `optional` **exitStatusOnSuccess?**: `0`

##### descriptor

> **descriptor**: [`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor)

##### provenance

> **provenance**: [`NativeSyntheticPpollSyscallContinuationProvenance`](#nativesyntheticppollsyscallcontinuationprovenance)

##### timespecOffset

> **timespecOffset**: `number`

##### sizeBytes

> **sizeBytes**: `number`

##### bytes

> **bytes**: `Uint8Array`

##### sourceTextReusedAsTargetCode

> **sourceTextReusedAsTargetCode**: `false`

##### sourceIsaEmulationUsed

> **sourceIsaEmulationUsed**: `false`

##### sidecarRuntimeUsed

> **sidecarRuntimeUsed**: `false`

***

### NativeSyntheticPpollSyscallContinuationResult

#### Properties

##### continuation?

> `optional` **continuation?**: [`NativeSyntheticPpollSyscallContinuation`](#nativesyntheticppollsyscallcontinuation)

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeSyntheticSleepSyscallArgumentProvenance

#### Extends

- [`NativeSyntheticSyscallArgumentDescriptor`](#nativesyntheticsyscallargumentdescriptor)

#### Properties

##### value

> **value**: `string`

###### Inherited from

[`NativeSyntheticSyscallArgumentDescriptor`](#nativesyntheticsyscallargumentdescriptor).[`value`](#value)

##### register

> **register**: `"rax"` \| `"rdx"` \| `"rsi"` \| `"rdi"` \| `"r10"`

###### Overrides

[`NativeSyntheticSyscallArgumentDescriptor`](#nativesyntheticsyscallargumentdescriptor).[`register`](#register)

##### role

> **role**: `"flags"` \| `"syscall-number"` \| `"clock-id"` \| `"request-timespec-pointer"` \| `"remainder-pointer"`

###### Overrides

[`NativeSyntheticSyscallArgumentDescriptor`](#nativesyntheticsyscallargumentdescriptor).[`role`](#role)

##### source

> **source**: [`NativeSyntheticContinuationProvenanceSource`](#nativesyntheticcontinuationprovenancesource)

###### Overrides

[`NativeSyntheticSyscallArgumentDescriptor`](#nativesyntheticsyscallargumentdescriptor).[`source`](#source-7)

***

### NativeSyntheticSleepSyscallRegisterSetupProvenance

#### Extends

- [`NativeSyntheticContinuationRegisterSetupDescriptor`](#nativesyntheticcontinuationregistersetupdescriptor)

#### Properties

##### abi

> **abi**: `"linux-amd64-syscall"`

###### Inherited from

[`NativeSyntheticContinuationRegisterSetupDescriptor`](#nativesyntheticcontinuationregistersetupdescriptor).[`abi`](#abi-1)

##### notes

> **notes**: `string`[]

###### Inherited from

[`NativeSyntheticContinuationRegisterSetupDescriptor`](#nativesyntheticcontinuationregistersetupdescriptor).[`notes`](#notes)

##### arguments

> **arguments**: [`NativeSyntheticSleepSyscallArgumentProvenance`](#nativesyntheticsleepsyscallargumentprovenance)[]

###### Overrides

[`NativeSyntheticContinuationRegisterSetupDescriptor`](#nativesyntheticcontinuationregistersetupdescriptor).[`arguments`](#arguments-1)

##### clobberedBySyscall

> **clobberedBySyscall**: \[`"rax"`, `"rcx"`, `"r11"`\]

###### Overrides

[`NativeSyntheticContinuationRegisterSetupDescriptor`](#nativesyntheticcontinuationregistersetupdescriptor).[`clobberedBySyscall`](#clobberedbysyscall)

***

### NativeSyntheticSleepSyscallStackSetupProvenance

#### Extends

- [`NativeSyntheticContinuationStackSetupDescriptor`](#nativesyntheticcontinuationstacksetupdescriptor)

#### Properties

##### entryStackPointer

> **entryStackPointer**: `"target-caller-frame-stack-pointer"`

###### Overrides

[`NativeSyntheticContinuationStackSetupDescriptor`](#nativesyntheticcontinuationstacksetupdescriptor).[`entryStackPointer`](#entrystackpointer)

##### stackBytesWrittenByContinuation

> **stackBytesWrittenByContinuation**: `0`

###### Overrides

[`NativeSyntheticContinuationStackSetupDescriptor`](#nativesyntheticcontinuationstacksetupdescriptor).[`stackBytesWrittenByContinuation`](#stackbyteswrittenbycontinuation)

##### returnAddress

> **returnAddress**: `"not-used-exit-process-completion"` \| `"trampoline-sentinel-return-address"`

###### Overrides

[`NativeSyntheticContinuationStackSetupDescriptor`](#nativesyntheticcontinuationstacksetupdescriptor).[`returnAddress`](#returnaddress-2)

##### requiresSourceStackBytes

> **requiresSourceStackBytes**: `false`

###### Overrides

[`NativeSyntheticContinuationStackSetupDescriptor`](#nativesyntheticcontinuationstacksetupdescriptor).[`requiresSourceStackBytes`](#requiressourcestackbytes)

***

### NativeSyntheticSleepSyscallCompletionProvenance

#### Extends

- [`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor)

#### Properties

##### restartContract?

> `optional` **restartContract?**: [`NativeSyntheticContinuationRestartContract`](#nativesyntheticcontinuationrestartcontract)

###### Inherited from

[`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor).[`restartContract`](#restartcontract)

##### failureKind?

> `optional` **failureKind?**: [`NativeSyntheticContinuationFailureKind`](#nativesyntheticcontinuationfailurekind)

Legacy single-bucket failure kind. Prefer failureExitBuckets for new continuations.

###### Inherited from

[`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor).[`failureKind`](#failurekind-1)

##### failureReason?

> `optional` **failureReason?**: `string`

Legacy single-bucket failure reason. Prefer failureExitBuckets for new continuations.

###### Inherited from

[`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor).[`failureReason`](#failurereason-1)

##### mode

> **mode**: [`NativeSyntheticSleepCompletionMode`](#nativesyntheticsleepcompletionmode)

###### Overrides

[`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor).[`mode`](#mode-3)

##### successExitStatus?

> `optional` **successExitStatus?**: `0`

###### Overrides

[`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor).[`successExitStatus`](#successexitstatus)

##### failureExitStatus?

> `optional` **failureExitStatus?**: `111`

Legacy single-bucket failure status. Prefer failureExitBuckets for new continuations.

###### Overrides

[`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor).[`failureExitStatus`](#failureexitstatus)

##### failureExitBuckets?

> `optional` **failureExitBuckets?**: [`NativeSyntheticContinuationFailureExitBucket`](#nativesyntheticcontinuationfailureexitbucket)[]

###### Overrides

[`NativeSyntheticContinuationCompletionDescriptor`](#nativesyntheticcontinuationcompletiondescriptor).[`failureExitBuckets`](#failureexitbuckets)

***

### NativeSyntheticSleepSyscallContinuationProvenance

#### Extends

- [`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor)

#### Properties

##### kind

> **kind**: `"synthetic-syscall-continuation"`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`kind`](#kind-17)

##### targetArch

> **targetArch**: `"amd64"`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`targetArch`](#targetarch-6)

##### entryAddress

> **entryAddress**: `string`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`entryAddress`](#entryaddress-1)

##### relativeAddress

> **relativeAddress**: `string`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`relativeAddress`](#relativeaddress-3)

##### byteSource

> **byteSource**: `"generated-target-native-amd64-syscall-sequence"`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`byteSource`](#bytesource)

##### byteEncoding

> **byteEncoding**: `"amd64-machine-code"`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`byteEncoding`](#byteencoding)

##### sizeBytes

> **sizeBytes**: `number`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`sizeBytes`](#sizebytes-9)

##### bytesHex

> **bytesHex**: `string`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`bytesHex`](#byteshex)

##### byteSha256

> **byteSha256**: `string`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`byteSha256`](#bytesha256)

##### descriptorSha256

> **descriptorSha256**: `string`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`descriptorSha256`](#descriptorsha256)

##### generatedTargetBytes

> **generatedTargetBytes**: `true`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`generatedTargetBytes`](#generatedtargetbytes)

##### sourceTextReusedAsTargetCode

> **sourceTextReusedAsTargetCode**: `false`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`sourceTextReusedAsTargetCode`](#sourcetextreusedastargetcode-2)

##### sourceIsaEmulationUsed

> **sourceIsaEmulationUsed**: `false`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`sourceIsaEmulationUsed`](#sourceisaemulationused-2)

##### sidecarRuntimeUsed

> **sidecarRuntimeUsed**: `false`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`sidecarRuntimeUsed`](#sidecarruntimeused-2)

##### syscallAbi

> **syscallAbi**: `"linux-amd64"`

###### Inherited from

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`syscallAbi`](#syscallabi)

##### generatorBuildId

> **generatorBuildId**: `"machinen-synthetic-sleep-syscall-v4"`

###### Overrides

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`generatorBuildId`](#generatorbuildid-1)

##### syscall

> **syscall**: [`NativeSyntheticSyscallDescriptor`](#nativesyntheticsyscalldescriptor) & `object`

###### Type Declaration

###### name

> **name**: `"clock_nanosleep"`

###### number

> **number**: `230`

###### arguments

> **arguments**: [`NativeSyntheticSleepSyscallArgumentProvenance`](#nativesyntheticsleepsyscallargumentprovenance)[]

###### Overrides

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`syscall`](#syscall-5)

##### embeddedData

> **embeddedData**: `object`

###### kind

> **kind**: `"timespec"`

###### offset

> **offset**: `number`

###### seconds

> **seconds**: `string`

###### nanoseconds

> **nanoseconds**: `number`

###### byteOrder

> **byteOrder**: `"little-endian"`

###### pointerRegister

> **pointerRegister**: `"rdx"`

###### pointerEncoding

> **pointerEncoding**: `"rip-relative"`

##### registerSetup

> **registerSetup**: [`NativeSyntheticSleepSyscallRegisterSetupProvenance`](#nativesyntheticsleepsyscallregistersetupprovenance)

###### Overrides

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`registerSetup`](#registersetup-1)

##### stackSetup

> **stackSetup**: [`NativeSyntheticSleepSyscallStackSetupProvenance`](#nativesyntheticsleepsyscallstacksetupprovenance)

###### Overrides

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`stackSetup`](#stacksetup-1)

##### completion

> **completion**: [`NativeSyntheticSleepSyscallCompletionProvenance`](#nativesyntheticsleepsyscallcompletionprovenance)

###### Overrides

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor).[`completion`](#completion-1)

***

### NativeSyntheticSleepSyscallContinuationRequest

#### Properties

##### threadId

> **threadId**: `string`

##### remainingTime

> **remainingTime**: [`NativeModeledSleepTimerRemainingTime`](#nativemodeledsleeptimerremainingtime)

##### sleepTimer?

> `optional` **sleepTimer?**: [`NativeModeledSleepTimerState`](#nativemodeledsleeptimerstate)

##### targetAddress?

> `optional` **targetAddress?**: `string`

##### completionMode?

> `optional` **completionMode?**: [`NativeSyntheticSleepCompletionMode`](#nativesyntheticsleepcompletionmode)

***

### NativeSyntheticSleepSyscallContinuation

#### Properties

##### kind

> **kind**: `"synthetic-sleep-syscall"`

##### threadId

> **threadId**: `string`

##### targetArch

> **targetArch**: `"amd64"`

##### entryAddress

> **entryAddress**: `string`

##### relativeAddress

> **relativeAddress**: `"0x0"`

##### syscall

> **syscall**: `object`

###### name

> **name**: `"clock_nanosleep"`

###### number

> **number**: `230`

###### clockId

> **clockId**: `0`

###### flags

> **flags**: `0`

###### requestPointerEncoding

> **requestPointerEncoding**: `"rip-relative-timespec"`

###### remainderPointer

> **remainderPointer**: `"0x0"`

##### remainingTime

> **remainingTime**: [`NativeModeledSleepTimerRemainingTime`](#nativemodeledsleeptimerremainingtime)

##### completionMode

> **completionMode**: [`NativeSyntheticSleepCompletionMode`](#nativesyntheticsleepcompletionmode)

##### exitStatusOnSuccess?

> `optional` **exitStatusOnSuccess?**: `0`

##### descriptor

> **descriptor**: [`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor)

##### provenance

> **provenance**: [`NativeSyntheticSleepSyscallContinuationProvenance`](#nativesyntheticsleepsyscallcontinuationprovenance)

##### timespecOffset

> **timespecOffset**: `number`

##### sizeBytes

> **sizeBytes**: `number`

##### bytes

> **bytes**: `Uint8Array`

##### sourceTextReusedAsTargetCode

> **sourceTextReusedAsTargetCode**: `false`

##### sourceIsaEmulationUsed

> **sourceIsaEmulationUsed**: `false`

##### sidecarRuntimeUsed

> **sidecarRuntimeUsed**: `false`

***

### NativeSyntheticSleepSyscallContinuationResult

#### Properties

##### continuation?

> `optional` **continuation?**: [`NativeSyntheticSleepSyscallContinuation`](#nativesyntheticsleepsyscallcontinuation)

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeSyntheticTargetCallerFramePolicy

#### Properties

##### mode

> **mode**: `"abi-neutral-sentinel"`

##### returnAddress?

> `optional` **returnAddress?**: `string`

##### stackPointer?

> `optional` **stackPointer?**: `string`

***

### NativeSyntheticTargetCallerFrameSlot

#### Properties

##### register

> **register**: [`NativeTargetFrameStateRegister`](#nativetargetframestateregister)

##### offset

> **offset**: `number`

##### value

> **value**: `string`

##### valueSource

> **valueSource**: [`NativeTargetFrameStateValueSource`](#nativetargetframestatevaluesource)

***

### NativeSyntheticTargetCallerFrame

#### Properties

##### id

> **id**: `string`

##### stackPointer

> **stackPointer**: `string`

##### returnAddress

> **returnAddress**: `string`

##### slots

> **slots**: [`NativeSyntheticTargetCallerFrameSlot`](#nativesynthetictargetcallerframeslot)[]

##### sourceTextReusedAsTargetCode

> **sourceTextReusedAsTargetCode**: `false`

##### sourceIsaEmulationUsed

> **sourceIsaEmulationUsed**: `false`

##### sidecarRuntimeUsed

> **sidecarRuntimeUsed**: `false`

***

### NativeSyntheticTargetCallerFramePlanRequest

#### Properties

##### frameState

> **frameState**: [`NativeTargetFrameStateMaterializationResult`](#nativetargetframestatematerializationresult)

##### policy?

> `optional` **policy?**: [`NativeSyntheticTargetCallerFramePolicy`](#nativesynthetictargetcallerframepolicy)

***

### NativeSyntheticTargetCallerFramePlanResult

#### Properties

##### state

> **state**: `"refused"` \| `"planned"`

##### frame?

> `optional` **frame?**: [`NativeSyntheticTargetCallerFrame`](#nativesynthetictargetcallerframe)

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeSyntheticTargetCallerFrameStatePolicy

#### Properties

##### mode

> **mode**: `"abi-neutral-sentinel"`

##### value?

> `optional` **value?**: `string`

***

### NativeTargetFrameRegisterValue

#### Properties

##### register

> **register**: [`NativeTargetFrameStateRegister`](#nativetargetframestateregister)

##### value

> **value**: `string`

##### source

> **source**: [`NativeTargetFrameStateValueSource`](#nativetargetframestatevaluesource)

***

### NativeTargetFrameStateRequirement

#### Properties

##### sourceFrameId

> **sourceFrameId**: `string`

##### targetAddress

> **targetAddress**: `string`

##### register

> **register**: [`NativeTargetFrameStateRegister`](#nativetargetframestateregister)

##### slot

> **slot**: [`NativeTargetCalleeSavedSlot`](#nativetargetcalleesavedslot)

***

### NativeTargetFrameStateMaterialization

#### Properties

##### requirement

> **requirement**: [`NativeTargetFrameStateRequirement`](#nativetargetframestaterequirement)

##### value

> **value**: `string`

##### valueSource

> **valueSource**: [`NativeTargetFrameStateValueSource`](#nativetargetframestatevaluesource)

***

### NativeTargetFrameStateMaterializationRequest

#### Properties

##### targetUnwind

> **targetUnwind**: [`NativeTargetUnwindMatchResult`](#nativetargetunwindmatchresult)

##### registerValues?

> `optional` **registerValues?**: [`NativeTargetFrameRegisterValue`](#nativetargetframeregistervalue)[]

##### syntheticTargetCaller?

> `optional` **syntheticTargetCaller?**: [`NativeSyntheticTargetCallerFrameStatePolicy`](#nativesynthetictargetcallerframestatepolicy)

***

### NativeTargetFrameStateMaterializationResult

#### Properties

##### requirements

> **requirements**: [`NativeTargetFrameStateRequirement`](#nativetargetframestaterequirement)[]

##### materialized

> **materialized**: [`NativeTargetFrameStateMaterialization`](#nativetargetframestatematerialization)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeTargetLandingModuleProvenance

#### Properties

##### id

> **id**: `string`

##### logicalName

> **logicalName**: `string`

##### path

> **path**: `string`

##### buildId

> **buildId**: `string`

##### loadBias

> **loadBias**: `string`

***

### NativeTargetLandingSectionProvenance

#### Properties

##### name

> **name**: `string`

##### addressStart

> **addressStart**: `string`

##### addressEnd

> **addressEnd**: `string`

##### fileOffsetStart

> **fileOffsetStart**: `string`

##### fileOffsetEnd

> **fileOffsetEnd**: `string`

##### flags

> **flags**: `string`

##### executable

> **executable**: `boolean`

##### match

> **match**: `"address"` \| `"file-offset"`

***

### NativeTargetLandingSymbolProvenance

#### Properties

##### name

> **name**: `string`

##### address

> **address**: `string`

##### offset

> **offset**: `string`

##### sizeBytes?

> `optional` **sizeBytes?**: `number`

##### type

> **type**: `string`

##### binding

> **binding**: `string`

##### containsLanding

> **containsLanding**: `boolean`

***

### NativeTargetLandingFdeProvenance

#### Properties

##### id

> **id**: `string`

##### functionName

> **functionName**: `string`

##### pcStart

> **pcStart**: `string`

##### pcEnd

> **pcEnd**: `string`

##### metadata

> **metadata**: [`NativeUnwindMetadataKind`](#nativeunwindmetadatakind)

***

### NativeTargetLandingDisassemblyProvenance

#### Properties

##### tool

> **tool**: `"objdump"`

##### addressStart?

> `optional` **addressStart?**: `string`

##### addressEnd?

> `optional` **addressEnd?**: `string`

##### lines

> **lines**: `string`[]

##### entryLine?

> `optional` **entryLine?**: `string`

##### previousLine?

> `optional` **previousLine?**: `string`

##### nextLine?

> `optional` **nextLine?**: `string`

***

### NativeTargetLandingInstructionBoundary

#### Properties

##### state

> **state**: [`NativeTargetLandingInstructionBoundaryState`](#nativetargetlandinginstructionboundarystate)

##### reason

> **reason**: `string`

***

### NativeTargetResumeLandingProvenance

#### Properties

##### id

> **id**: `string`

##### threadId

> **threadId**: `string`

##### sourceAddress

> **sourceAddress**: `string`

##### sourceRva

> **sourceRva**: `string`

##### targetRva

> **targetRva**: `string`

##### targetAddress

> **targetAddress**: `string`

##### targetRelativeAddress

> **targetRelativeAddress**: `string`

##### continuationStrategy

> **continuationStrategy**: [`NativeRealUtilityContinuationStrategy`](#nativerealutilitycontinuationstrategy)

##### semanticContinuation?

> `optional` **semanticContinuation?**: [`NativeRealUtilitySemanticContinuationSelection`](#nativerealutilitysemanticcontinuationselection)

##### syntheticContinuation?

> `optional` **syntheticContinuation?**: [`NativeRealUtilitySyntheticContinuationSelection`](#nativerealutilitysyntheticcontinuationselection)

##### targetFileOffset?

> `optional` **targetFileOffset?**: `number`

##### targetInstructionBytes?

> `optional` **targetInstructionBytes?**: `string`

##### targetModule

> **targetModule**: [`NativeTargetLandingModuleProvenance`](#nativetargetlandingmoduleprovenance)

##### section?

> `optional` **section?**: [`NativeTargetLandingSectionProvenance`](#nativetargetlandingsectionprovenance)

##### symbol?

> `optional` **symbol?**: [`NativeTargetLandingSymbolProvenance`](#nativetargetlandingsymbolprovenance)

##### fde?

> `optional` **fde?**: [`NativeTargetLandingFdeProvenance`](#nativetargetlandingfdeprovenance)

##### disassembly?

> `optional` **disassembly?**: [`NativeTargetLandingDisassemblyProvenance`](#nativetargetlandingdisassemblyprovenance)

##### instructionBoundary

> **instructionBoundary**: [`NativeTargetLandingInstructionBoundary`](#nativetargetlandinginstructionboundary)

##### refusal?

> `optional` **refusal?**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

***

### NativeTargetResumeLandingInspectionRequest

#### Properties

##### location

> **location**: [`NativeRealUtilityResolvedLocation`](#nativerealutilityresolvedlocation)

##### targetBytes?

> `optional` **targetBytes?**: [`NativeTargetModuleByteMaterialization`](#nativetargetmodulebytematerialization)

##### targetUnwindMatches?

> `optional` **targetUnwindMatches?**: [`NativeTargetUnwindFrameMatch`](#nativetargetunwindframematch)[]

##### readelfSections?

> `optional` **readelfSections?**: `string`

##### readelfSymbols?

> `optional` **readelfSymbols?**: `string`

##### objdumpDisassembly?

> `optional` **objdumpDisassembly?**: `string`

##### disassemblyAddressStart?

> `optional` **disassemblyAddressStart?**: `string`

##### disassemblyAddressEnd?

> `optional` **disassemblyAddressEnd?**: `string`

***

### NativeTargetModuleByteMaterializationRequest

#### Properties

##### module

> **module**: [`NativeRealUtilityTargetModule`](#nativerealutilitytargetmodule)

##### targetRoot?

> `optional` **targetRoot?**: `string`

##### relativeStart

> **relativeStart**: `string`

##### sizeBytes

> **sizeBytes**: `number`

##### fileOffset?

> `optional` **fileOffset?**: `number`

##### expectedBuildId?

> `optional` **expectedBuildId?**: `string`

***

### NativeTargetModuleByteMaterialization

#### Properties

##### moduleId

> **moduleId**: `string`

##### path

> **path**: `string`

##### buildId

> **buildId**: `string`

##### relativeStart

> **relativeStart**: `string`

##### relativeEnd

> **relativeEnd**: `string`

##### fileOffset

> **fileOffset**: `number`

##### sizeBytes

> **sizeBytes**: `number`

##### bytes

> **bytes**: `Uint8Array`

##### sourceTextReusedAsTargetCode

> **sourceTextReusedAsTargetCode**: `false`

***

### NativeTargetModuleByteMaterializationResult

#### Properties

##### materialized?

> `optional` **materialized?**: [`NativeTargetModuleByteMaterialization`](#nativetargetmodulebytematerialization)

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeTargetResumeFaultRegisters

#### Properties

##### rax?

> `optional` **rax?**: `string`

##### rbx?

> `optional` **rbx?**: `string`

##### rcx?

> `optional` **rcx?**: `string`

##### rdx?

> `optional` **rdx?**: `string`

##### rsi?

> `optional` **rsi?**: `string`

##### rdi?

> `optional` **rdi?**: `string`

##### rbp?

> `optional` **rbp?**: `string`

##### rsp?

> `optional` **rsp?**: `string`

##### r8?

> `optional` **r8?**: `string`

##### r9?

> `optional` **r9?**: `string`

##### r10?

> `optional` **r10?**: `string`

##### r11?

> `optional` **r11?**: `string`

##### r12?

> `optional` **r12?**: `string`

##### r13?

> `optional` **r13?**: `string`

##### r14?

> `optional` **r14?**: `string`

##### r15?

> `optional` **r15?**: `string`

***

### NativeTargetResumeFaultClassification

#### Properties

##### boundary

> **boundary**: `"target-resume-fault-state"`

##### refusal

> **refusal**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

##### signal?

> `optional` **signal?**: `string`

##### faultAddress?

> `optional` **faultAddress?**: `string`

##### targetInstructionPointer?

> `optional` **targetInstructionPointer?**: `string`

##### targetInstructionBytes?

> `optional` **targetInstructionBytes?**: `string`

##### registers?

> `optional` **registers?**: [`NativeTargetResumeFaultRegisters`](#nativetargetresumefaultregisters)

##### attemptedResume

> **attemptedResume**: `true`

##### migrationCompleted

> **migrationCompleted**: `false`

***

### NativeTargetResumeFaultClassificationResult

#### Properties

##### state

> **state**: `"classified"` \| `"not-faulted"` \| `"unattempted"`

##### classification?

> `optional` **classification?**: [`NativeTargetResumeFaultClassification`](#nativetargetresumefaultclassification)

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeTargetResumeFaultClassificationOptions

#### Properties

##### landingProvenance?

> `optional` **landingProvenance?**: [`NativeTargetResumeLandingProvenance`](#nativetargetresumelandingprovenance)[]

***

### NativeTargetResumeExecutionAttempt

#### Properties

##### status

> **status**: [`NativeTargetResumeExecutionAttemptStatus`](#nativetargetresumeexecutionattemptstatus)

##### targetArch

> **targetArch**: `"amd64"`

##### entryAddress

> **entryAddress**: `string`

##### stackPointer

> **stackPointer**: `string`

##### targetBytesStart

> **targetBytesStart**: `string`

##### targetBytesEnd

> **targetBytesEnd**: `string`

##### targetInstructionPointer?

> `optional` **targetInstructionPointer?**: `string`

##### targetInstructionBytes?

> `optional` **targetInstructionBytes?**: `string`

##### registers?

> `optional` **registers?**: [`NativeTargetResumeFaultRegisters`](#nativetargetresumefaultregisters)

##### signal?

> `optional` **signal?**: `string`

##### signalNumber?

> `optional` **signalNumber?**: `number`

##### faultAddress?

> `optional` **faultAddress?**: `string`

##### returnValue?

> `optional` **returnValue?**: `string`

##### exitStatus?

> `optional` **exitStatus?**: `number`

##### instructionPointerInTargetBytes

> **instructionPointerInTargetBytes**: `boolean`

##### attemptedResume

> **attemptedResume**: `true`

##### sourceTextReusedAsTargetCode

> **sourceTextReusedAsTargetCode**: `false`

##### sourceIsaEmulationUsed

> **sourceIsaEmulationUsed**: `false`

##### sidecarRuntimeUsed

> **sidecarRuntimeUsed**: `false`

***

### NativeTargetResumeExecutionPlan

#### Properties

##### mode

> **mode**: `"planned-not-executed"`

##### executor

> **executor**: `"native-resume-trampoline"`

##### targetArch

> **targetArch**: `"amd64"`

##### entryAddress

> **entryAddress**: `string`

##### stackPointer

> **stackPointer**: `string`

##### callerFrameId

> **callerFrameId**: `string`

##### targetModuleByteModules

> **targetModuleByteModules**: `string`[]

##### attemptedResume

> **attemptedResume**: `false`

##### sourceTextReusedAsTargetCode

> **sourceTextReusedAsTargetCode**: `false`

##### sourceIsaEmulationUsed

> **sourceIsaEmulationUsed**: `false`

##### sidecarRuntimeUsed

> **sidecarRuntimeUsed**: `false`

***

### NativeTargetResumeExecutionPlanRequest

#### Properties

##### codeLocations

> **codeLocations**: [`NativeCodeLocationMapping`](#nativecodelocationmapping)[]

##### targetModuleBytes

> **targetModuleBytes**: [`NativeTargetModuleByteMaterialization`](#nativetargetmodulebytematerialization)[]

##### callerFrame?

> `optional` **callerFrame?**: [`NativeSyntheticTargetCallerFrame`](#nativesynthetictargetcallerframe)

***

### NativeTargetResumeExecutionPlanResult

#### Properties

##### state

> **state**: `"refused"` \| `"planned"`

##### plan?

> `optional` **plan?**: [`NativeTargetResumeExecutionPlan`](#nativetargetresumeexecutionplan)

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeTargetUnwindFrameRule

#### Properties

##### id

> **id**: `string`

##### functionName

> **functionName**: `string`

##### mapping

> **mapping**: `string`

##### pcStart

> **pcStart**: `string`

##### pcEnd

> **pcEnd**: `string`

##### metadata

> **metadata**: [`NativeUnwindMetadataKind`](#nativeunwindmetadatakind)

##### cfa

> **cfa**: `object`

###### register

> **register**: `"rsp"` \| `"rbp"`

###### offset

> **offset**: `number`

##### returnAddress

> **returnAddress**: `object`

###### location

> **location**: `"cfa-relative"`

###### offset

> **offset**: `number`

##### calleeSaved?

> `optional` **calleeSaved?**: `object`[]

###### register

> **register**: `"rbx"` \| `"rbp"` \| `"r12"` \| `"r13"` \| `"r14"` \| `"r15"`

###### location

> **location**: `"cfa-relative"` \| `"same-value"`

###### offset?

> `optional` **offset?**: `number`

***

### NativeTargetEhFrameTextParseRequest

#### Properties

##### readelfFrames

> **readelfFrames**: `string`

##### mapping

> **mapping**: `string`

##### functionName

> **functionName**: `string`

##### targetAddress

> **targetAddress**: `string`

##### loadBias?

> `optional` **loadBias?**: `string`

***

### NativeTargetEhFrameTextParseResult

#### Properties

##### rules

> **rules**: [`NativeTargetUnwindFrameRule`](#nativetargetunwindframerule)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeTargetUnwindMatchRequest

#### Properties

##### sourceFrame

> **sourceFrame**: [`NativeDiscoveredUnwindFrame`](#nativediscoveredunwindframe)

##### targetAddress

> **targetAddress**: `string`

##### targetRules

> **targetRules**: [`NativeTargetUnwindFrameRule`](#nativetargetunwindframerule)[]

##### calleeSavedPolicy?

> `optional` **calleeSavedPolicy?**: [`NativeTargetCalleeSavedPolicy`](#nativetargetcalleesavedpolicy)

***

### NativeTargetCalleeSavedSlot

#### Properties

##### register

> **register**: `"rbx"` \| `"rbp"` \| `"r12"` \| `"r13"` \| `"r14"` \| `"r15"`

##### offset

> **offset**: `number`

***

### NativeTargetUnwindFrameMatch

#### Properties

##### sourceFrameId

> **sourceFrameId**: `string`

##### targetRule

> **targetRule**: [`NativeTargetUnwindFrameRule`](#nativetargetunwindframerule)

##### targetAddress

> **targetAddress**: `string`

##### targetReturnAddressSlotOffset

> **targetReturnAddressSlotOffset**: `number`

##### targetCalleeSavedSlots?

> `optional` **targetCalleeSavedSlots?**: [`NativeTargetCalleeSavedSlot`](#nativetargetcalleesavedslot)[]

##### preservesReturnContract

> **preservesReturnContract**: `true`

***

### NativeTargetUnwindMatchResult

#### Properties

##### matches

> **matches**: [`NativeTargetUnwindFrameMatch`](#nativetargetunwindframematch)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeThreadRestorePlanRequest

#### Properties

##### threads

> **threads**: [`NativeThreadState`](#nativethreadstate)[]

##### mappings?

> `optional` **mappings?**: [`NativeMemoryMapping`](#nativememorymapping)[]

##### resources?

> `optional` **resources?**: [`NativeProcessResource`](#nativeprocessresource)[]

##### tls?

> `optional` **tls?**: `object`

###### targetFsBase?

> `optional` **targetFsBase?**: `string`

###### targetGsBase?

> `optional` **targetGsBase?**: `string`

###### targetAccessPolicy?

> `optional` **targetAccessPolicy?**: [`NativeTlsTargetAccessPolicy`](#nativetlstargetaccesspolicy)

***

### NativeTlsSegmentBaseHandoffRequest

#### Properties

##### threadId

> **threadId**: `string`

##### sourceArch

> **sourceArch**: `"amd64"` \| `"arm64"`

##### targetArch

> **targetArch**: `"amd64"` \| `"arm64"`

##### sourceThreadPointer?

> `optional` **sourceThreadPointer?**: `string`

##### sourceRegister?

> `optional` **sourceRegister?**: [`NativeTlsThreadPointerRegister`](#nativetlsthreadpointerregister)

##### targetFsBase?

> `optional` **targetFsBase?**: `string`

##### targetGsBase?

> `optional` **targetGsBase?**: `string`

##### targetAccessPolicy?

> `optional` **targetAccessPolicy?**: [`NativeTlsTargetAccessPolicy`](#nativetlstargetaccesspolicy)

##### capturedTargetSegmentBases?

> `optional` **capturedTargetSegmentBases?**: [`NativeTlsAmd64SegmentBases`](#nativetlsamd64segmentbases)

***

### NativeThreadTlsPolicyRequest

#### Properties

##### thread

> **thread**: [`NativeThreadState`](#nativethreadstate)

##### targetArch?

> `optional` **targetArch?**: `"amd64"` \| `"arm64"`

##### targetFsBase?

> `optional` **targetFsBase?**: `string`

##### targetGsBase?

> `optional` **targetGsBase?**: `string`

##### targetAccessPolicy?

> `optional` **targetAccessPolicy?**: [`NativeTlsTargetAccessPolicy`](#nativetlstargetaccesspolicy)

***

### NativeUnwindFrameRule

#### Properties

##### id

> **id**: `string`

##### functionName

> **functionName**: `string`

##### mapping

> **mapping**: `string`

##### pcStart

> **pcStart**: `string`

##### pcEnd

> **pcEnd**: `string`

##### metadata

> **metadata**: [`NativeUnwindMetadataKind`](#nativeunwindmetadatakind)

##### cfa

> **cfa**: `object`

###### register

> **register**: `"sp"` \| `"x29"`

###### offset

> **offset**: `number`

##### returnAddress

> **returnAddress**: \{ `location`: `"register"`; `register`: `"x30"`; \} \| \{ `location`: `"cfa-relative"`; `offset`: `number`; \}

***

### NativeUnwindStackWord

#### Properties

##### address

> **address**: `string`

##### value

> **value**: `string`

***

### NativeUnwindFrameDiscoveryRequest

#### Properties

##### threadId

> **threadId**: `string`

##### stackMapping

> **stackMapping**: `string`

##### sourceRegisters

> **sourceRegisters**: [`NativeRegisterState`](#nativeregisterstate)

##### rules

> **rules**: [`NativeUnwindFrameRule`](#nativeunwindframerule)[]

##### stackWords

> **stackWords**: [`NativeUnwindStackWord`](#nativeunwindstackword)[]

***

### NativeEhFrameTextParseRequest

#### Properties

##### readelfFrames

> **readelfFrames**: `string`

##### mapping

> **mapping**: `string`

##### functionName

> **functionName**: `string`

##### pc

> **pc**: `string`

##### loadBias?

> `optional` **loadBias?**: `string`

***

### NativeEhFrameTextParseResult

#### Properties

##### rules

> **rules**: [`NativeUnwindFrameRule`](#nativeunwindframerule)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### NativeDiscoveredUnwindFrame

#### Properties

##### id

> **id**: `string`

##### functionName

> **functionName**: `string`

##### sourcePc

> **sourcePc**: `string`

##### sourceSp

> **sourceSp**: `string`

##### cfa

> **cfa**: `string`

##### returnAddress

> **returnAddress**: `string`

##### returnAddressSlot?

> `optional` **returnAddressSlot?**: `string`

##### metadata

> **metadata**: [`NativeUnwindMetadataKind`](#nativeunwindmetadatakind)

##### stackFrame

> **stackFrame**: [`NativeStackFrame`](#nativestackframe)

***

### NativeUnwindFrameDiscoveryResult

#### Properties

##### frames

> **frames**: [`NativeDiscoveredUnwindFrame`](#nativediscoveredunwindframe)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### PortableMachineVmRestoreProofRequest

#### Properties

##### bundleDir?

> `optional` **bundleDir?**: `string`

##### targetCodeFile?

> `optional` **targetCodeFile?**: `string`

##### targetImage?

> `optional` **targetImage?**: `string`

***

### PortableMachineTargetResourceStatus

#### Properties

##### kind

> **kind**: `string`

##### status

> **status**: `"passed"` \| `"failed"`

***

### PortableMachineTargetRestoreObservation

#### Extended by

- [`PortableMachineVmRestoreProofPlan`](#portablemachinevmrestoreproofplan)
- [`PortableMachineVmRestoreTargetResult`](#portablemachinevmrestoretargetresult)

#### Properties

##### targetVerifierResult?

> `optional` **targetVerifierResult?**: [`PortableMachineTargetVerifierResult`](#portablemachinetargetverifierresult)

##### targetStateConsumptionResult?

> `optional` **targetStateConsumptionResult?**: [`PortableMachineTargetStateConsumptionResult`](#portablemachinetargetstateconsumptionresult)

##### targetResourceStatuses?

> `optional` **targetResourceStatuses?**: [`PortableMachineTargetResourceStatus`](#portablemachinetargetresourcestatus)[]

##### targetReturnChainResult?

> `optional` **targetReturnChainResult?**: [`PortableMachineTargetReturnChainResult`](#portablemachinetargetreturnchainresult)

##### targetTranslatedReturnAddress?

> `optional` **targetTranslatedReturnAddress?**: `string`

##### targetFrameRestoreResult?

> `optional` **targetFrameRestoreResult?**: [`PortableMachineTargetFrameRestoreResult`](#portablemachinetargetframerestoreresult)

##### targetTranslatedFramePointer?

> `optional` **targetTranslatedFramePointer?**: `string`

##### targetRegisterRestoreResult?

> `optional` **targetRegisterRestoreResult?**: [`PortableMachineTargetRegisterRestoreResult`](#portablemachinetargetregisterrestoreresult)

##### targetRflagsRestoreResult?

> `optional` **targetRflagsRestoreResult?**: [`PortableMachineTargetRflagsRestoreResult`](#portablemachinetargetrflagsrestoreresult)

##### targetTlsRestoreResult?

> `optional` **targetTlsRestoreResult?**: [`PortableMachineTargetTlsRestoreResult`](#portablemachinetargettlsrestoreresult)

##### targetThreadRestoreResult?

> `optional` **targetThreadRestoreResult?**: [`PortableMachineTargetThreadRestoreResult`](#portablemachinetargetthreadrestoreresult)

##### targetThreadRestoreThreadId?

> `optional` **targetThreadRestoreThreadId?**: `string`

##### targetResumePathResult?

> `optional` **targetResumePathResult?**: [`PortableMachineTargetResumePathResult`](#portablemachinetargetresumepathresult)

##### targetResumePathMode?

> `optional` **targetResumePathMode?**: `string`

***

### PortableMachineVmRestoreProofPlan

#### Extends

- [`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation)

#### Properties

##### targetVerifierResult?

> `optional` **targetVerifierResult?**: [`PortableMachineTargetVerifierResult`](#portablemachinetargetverifierresult)

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetVerifierResult`](#targetverifierresult)

##### targetStateConsumptionResult?

> `optional` **targetStateConsumptionResult?**: [`PortableMachineTargetStateConsumptionResult`](#portablemachinetargetstateconsumptionresult)

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetStateConsumptionResult`](#targetstateconsumptionresult)

##### targetResourceStatuses?

> `optional` **targetResourceStatuses?**: [`PortableMachineTargetResourceStatus`](#portablemachinetargetresourcestatus)[]

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetResourceStatuses`](#targetresourcestatuses)

##### targetReturnChainResult?

> `optional` **targetReturnChainResult?**: [`PortableMachineTargetReturnChainResult`](#portablemachinetargetreturnchainresult)

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetReturnChainResult`](#targetreturnchainresult)

##### targetTranslatedReturnAddress?

> `optional` **targetTranslatedReturnAddress?**: `string`

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetTranslatedReturnAddress`](#targettranslatedreturnaddress)

##### targetFrameRestoreResult?

> `optional` **targetFrameRestoreResult?**: [`PortableMachineTargetFrameRestoreResult`](#portablemachinetargetframerestoreresult)

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetFrameRestoreResult`](#targetframerestoreresult)

##### targetTranslatedFramePointer?

> `optional` **targetTranslatedFramePointer?**: `string`

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetTranslatedFramePointer`](#targettranslatedframepointer)

##### targetRegisterRestoreResult?

> `optional` **targetRegisterRestoreResult?**: [`PortableMachineTargetRegisterRestoreResult`](#portablemachinetargetregisterrestoreresult)

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetRegisterRestoreResult`](#targetregisterrestoreresult)

##### targetRflagsRestoreResult?

> `optional` **targetRflagsRestoreResult?**: [`PortableMachineTargetRflagsRestoreResult`](#portablemachinetargetrflagsrestoreresult)

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetRflagsRestoreResult`](#targetrflagsrestoreresult)

##### targetTlsRestoreResult?

> `optional` **targetTlsRestoreResult?**: [`PortableMachineTargetTlsRestoreResult`](#portablemachinetargettlsrestoreresult)

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetTlsRestoreResult`](#targettlsrestoreresult)

##### targetThreadRestoreResult?

> `optional` **targetThreadRestoreResult?**: [`PortableMachineTargetThreadRestoreResult`](#portablemachinetargetthreadrestoreresult)

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetThreadRestoreResult`](#targetthreadrestoreresult)

##### targetThreadRestoreThreadId?

> `optional` **targetThreadRestoreThreadId?**: `string`

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetThreadRestoreThreadId`](#targetthreadrestorethreadid)

##### targetResumePathResult?

> `optional` **targetResumePathResult?**: [`PortableMachineTargetResumePathResult`](#portablemachinetargetresumepathresult)

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetResumePathResult`](#targetresumepathresult)

##### targetResumePathMode?

> `optional` **targetResumePathMode?**: `string`

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetResumePathMode`](#targetresumepathmode)

##### phase

> **phase**: `"portable-machine-vm-restore-proof"`

##### state

> **state**: [`PortableMachineVmRestoreProofState`](#portablemachinevmrestoreproofstate)

##### portableMachineBundle?

> `optional` **portableMachineBundle?**: `string`

##### targetCodeFile?

> `optional` **targetCodeFile?**: `string`

##### targetImage?

> `optional` **targetImage?**: `string`

##### sourceGuestArch?

> `optional` **sourceGuestArch?**: `"arm64"`

##### targetGuestArch?

> `optional` **targetGuestArch?**: `"amd64"`

##### targetVmRequired

> **targetVmRequired**: `true`

##### targetNativeCompletionRequired

> **targetNativeCompletionRequired**: `true`

##### migrationCompleted

> **migrationCompleted**: `boolean`

##### descriptorGateCompleted

> **descriptorGateCompleted**: `boolean`

##### descriptorMemoryEntryCount?

> `optional` **descriptorMemoryEntryCount?**: `number`

##### descriptorFdRecipeCount?

> `optional` **descriptorFdRecipeCount?**: `number`

##### descriptorResourceKinds?

> `optional` **descriptorResourceKinds?**: `string`[]

##### targetContinuationKind?

> `optional` **targetContinuationKind?**: [`PortableMachineTargetContinuationKind`](#portablemachinetargetcontinuationkind)

##### targetContinuationStatus?

> `optional` **targetContinuationStatus?**: `string`

##### targetContinuationReturnValue?

> `optional` **targetContinuationReturnValue?**: `string`

##### targetModuleBytesSource?

> `optional` **targetModuleBytesSource?**: `string`

##### sourceTextReusedAsTargetCode

> **sourceTextReusedAsTargetCode**: `false`

##### sourceIsaEmulationUsed

> **sourceIsaEmulationUsed**: `false`

##### sidecarRuntimeUsed

> **sidecarRuntimeUsed**: `false`

##### refusal?

> `optional` **refusal?**: `object`

###### code

> **code**: `string`

###### message

> **message**: `string`

##### skipReason?

> `optional` **skipReason?**: `string`

***

### PortableMachineVmRestoreTargetResult

#### Extends

- [`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation)

#### Properties

##### targetVerifierResult?

> `optional` **targetVerifierResult?**: [`PortableMachineTargetVerifierResult`](#portablemachinetargetverifierresult)

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetVerifierResult`](#targetverifierresult)

##### targetStateConsumptionResult?

> `optional` **targetStateConsumptionResult?**: [`PortableMachineTargetStateConsumptionResult`](#portablemachinetargetstateconsumptionresult)

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetStateConsumptionResult`](#targetstateconsumptionresult)

##### targetResourceStatuses?

> `optional` **targetResourceStatuses?**: [`PortableMachineTargetResourceStatus`](#portablemachinetargetresourcestatus)[]

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetResourceStatuses`](#targetresourcestatuses)

##### targetReturnChainResult?

> `optional` **targetReturnChainResult?**: [`PortableMachineTargetReturnChainResult`](#portablemachinetargetreturnchainresult)

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetReturnChainResult`](#targetreturnchainresult)

##### targetTranslatedReturnAddress?

> `optional` **targetTranslatedReturnAddress?**: `string`

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetTranslatedReturnAddress`](#targettranslatedreturnaddress)

##### targetFrameRestoreResult?

> `optional` **targetFrameRestoreResult?**: [`PortableMachineTargetFrameRestoreResult`](#portablemachinetargetframerestoreresult)

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetFrameRestoreResult`](#targetframerestoreresult)

##### targetTranslatedFramePointer?

> `optional` **targetTranslatedFramePointer?**: `string`

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetTranslatedFramePointer`](#targettranslatedframepointer)

##### targetRegisterRestoreResult?

> `optional` **targetRegisterRestoreResult?**: [`PortableMachineTargetRegisterRestoreResult`](#portablemachinetargetregisterrestoreresult)

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetRegisterRestoreResult`](#targetregisterrestoreresult)

##### targetRflagsRestoreResult?

> `optional` **targetRflagsRestoreResult?**: [`PortableMachineTargetRflagsRestoreResult`](#portablemachinetargetrflagsrestoreresult)

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetRflagsRestoreResult`](#targetrflagsrestoreresult)

##### targetTlsRestoreResult?

> `optional` **targetTlsRestoreResult?**: [`PortableMachineTargetTlsRestoreResult`](#portablemachinetargettlsrestoreresult)

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetTlsRestoreResult`](#targettlsrestoreresult)

##### targetThreadRestoreResult?

> `optional` **targetThreadRestoreResult?**: [`PortableMachineTargetThreadRestoreResult`](#portablemachinetargetthreadrestoreresult)

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetThreadRestoreResult`](#targetthreadrestoreresult)

##### targetThreadRestoreThreadId?

> `optional` **targetThreadRestoreThreadId?**: `string`

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetThreadRestoreThreadId`](#targetthreadrestorethreadid)

##### targetResumePathResult?

> `optional` **targetResumePathResult?**: [`PortableMachineTargetResumePathResult`](#portablemachinetargetresumepathresult)

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetResumePathResult`](#targetresumepathresult)

##### targetResumePathMode?

> `optional` **targetResumePathMode?**: `string`

###### Inherited from

[`PortableMachineTargetRestoreObservation`](#portablemachinetargetrestoreobservation).[`targetResumePathMode`](#targetresumepathmode)

##### exitCode

> **exitCode**: `number`

##### migrationCompleted?

> `optional` **migrationCompleted?**: `boolean`

##### descriptorGateCompleted?

> `optional` **descriptorGateCompleted?**: `boolean`

##### actualResumeEvent?

> `optional` **actualResumeEvent?**: `object`

###### status?

> `optional` **status?**: `string`

###### returnValue?

> `optional` **returnValue?**: `string`

##### sourceTextReusedAsTargetCode?

> `optional` **sourceTextReusedAsTargetCode?**: `boolean`

##### sourceIsaEmulationUsed?

> `optional` **sourceIsaEmulationUsed?**: `boolean`

##### sidecarRuntimeUsed?

> `optional` **sidecarRuntimeUsed?**: `boolean`

***

### PortableMachineTargetRestoreDescriptorRequest

#### Properties

##### continuation

> **continuation**: [`TargetGuestRestoreContinuationDescriptor`](#targetguestrestorecontinuationdescriptor)

##### translatedFrame?

> `optional` **translatedFrame?**: [`TargetGuestTranslatedFrameDescriptor`](#targetguesttranslatedframedescriptor)

##### fdTable

> **fdTable**: [`NativeTargetFdTablePlan`](#nativetargetfdtableplan)

##### memory

> **memory**: [`TargetGuestMemoryMaterializationResult`](#targetguestmemorymaterializationresult)

***

### PortableMachineSnapshotRefusal

#### Properties

##### code

> **code**: `"cross-isa-vmstate-restore-unsupported"` \| `"raw-vcpu-state-unsupported"` \| `"raw-kernel-state-unsupported"` \| `"raw-device-state-unsupported"` \| `"target-isa-vm-restore-loader-missing"` \| `"portable-process-image-missing"`

##### message

> **message**: `string`

##### detail?

> `optional` **detail?**: `Record`\<`string`, `unknown`\>

***

### PortableMachineSnapshotRefusals

#### Properties

##### vocabularyVersion

> **vocabularyVersion**: `1`

##### refusals

> **refusals**: [`PortableMachineSnapshotRefusal`](#portablemachinesnapshotrefusal)[]

***

### PortableMachineSnapshotDocuments

#### Properties

##### rootDir?

> `optional` **rootDir?**: `string`

##### manifest

> **manifest**: [`PortableMachineSnapshotManifest`](#portablemachinesnapshotmanifest)

##### nativeProcessImage

> **nativeProcessImage**: [`NativeProcessImageDocuments`](#nativeprocessimagedocuments)

***

### PortableMachineSnapshotManifest

#### Properties

##### formatVersion

> **formatVersion**: `1`

##### kind

> **kind**: `"machinen.portable-machine-snapshot"`

##### source

> **source**: `object`

###### guestArch

> **guestArch**: `"amd64"` \| `"arm64"`

###### vmstate

> **vmstate**: `object`

###### vmstate.rawRestore

> **rawRestore**: `"refused"`

###### vmstate.refusalCode

> **refusalCode**: `"cross-isa-vmstate-restore-unsupported"`

###### vmstate.reason

> **reason**: `string`

###### kernelState

> **kernelState**: `"not-translated"`

###### deviceState

> **deviceState**: `"not-translated"`

##### target

> **target**: `object`

###### guestArch

> **guestArch**: `"amd64"` \| `"arm64"`

###### mode

> **mode**: `"target-isa-vm-process-restore"`

###### execution

> **execution**: `"target-native"`

##### payload

> **payload**: `object`

###### nativeProcessImage

> **nativeProcessImage**: `object`

###### nativeProcessImage.kind

> **kind**: `"machinen.native-process-image"`

###### nativeProcessImage.path

> **path**: `string`

###### resourceModel

> **resourceModel**: `"explicit-recipes-only"`

##### refusals

> **refusals**: [`PortableMachineSnapshotRefusals`](#portablemachinesnapshotrefusals)

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

### VsockSecretsOptions

#### Properties

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

How long to keep retrying the UDS connect. Default 10s.

##### retryMs?

> `optional` **retryMs?**: `number`

Poll interval in ms while retrying. Default 250.

***

### TargetGuestCopyCapturedBytesEntry

#### Extends

- `TargetGuestMemoryMaterializationEntryBase`

#### Properties

##### mapping

> **mapping**: `string`

###### Inherited from

`TargetGuestMemoryMaterializationEntryBase.mapping`

##### targetStart

> **targetStart**: `string`

###### Inherited from

`TargetGuestMemoryMaterializationEntryBase.targetStart`

##### sizeBytes

> **sizeBytes**: `number`

###### Inherited from

`TargetGuestMemoryMaterializationEntryBase.sizeBytes`

##### permissions

> **permissions**: `string`

###### Inherited from

`TargetGuestMemoryMaterializationEntryBase.permissions`

##### kind

> **kind**: `"copy-captured-bytes"`

###### Overrides

`TargetGuestMemoryMaterializationEntryBase.kind`

##### sourceFile

> **sourceFile**: `string`

##### sourceOffset

> **sourceOffset**: `number`

##### provenance

> **provenance**: `"native-process-image"`

###### Overrides

`TargetGuestMemoryMaterializationEntryBase.provenance`

***

### TargetGuestRecreateGuardEntry

#### Extends

- `TargetGuestMemoryMaterializationEntryBase`

#### Properties

##### mapping

> **mapping**: `string`

###### Inherited from

`TargetGuestMemoryMaterializationEntryBase.mapping`

##### targetStart

> **targetStart**: `string`

###### Inherited from

`TargetGuestMemoryMaterializationEntryBase.targetStart`

##### sizeBytes

> **sizeBytes**: `number`

###### Inherited from

`TargetGuestMemoryMaterializationEntryBase.sizeBytes`

##### permissions

> **permissions**: `string`

###### Inherited from

`TargetGuestMemoryMaterializationEntryBase.permissions`

##### kind

> **kind**: `"recreate-guard"`

###### Overrides

`TargetGuestMemoryMaterializationEntryBase.kind`

##### provenance

> **provenance**: `"guard-protection"`

###### Overrides

`TargetGuestMemoryMaterializationEntryBase.provenance`

***

### TargetGuestMemoryMaterializationRequest

#### Properties

##### mappings

> **mappings**: [`NativeMemoryMapping`](#nativememorymapping)[]

##### memorySizeBytes

> **memorySizeBytes**: `number`

##### memoryFile

> **memoryFile**: `string`

***

### TargetGuestMemoryMaterializationResult

#### Properties

##### entries

> **entries**: [`TargetGuestMemoryMaterializationEntry`](#targetguestmemorymaterializationentry)[]

##### refusals

> **refusals**: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### TargetGuestRestoreContinuationDescriptor

#### Properties

##### codeFile

> **codeFile**: `string`

##### fileOffset

> **fileOffset**: `number`

##### codeSize

> **codeSize**: `number`

##### targetAddress

> **targetAddress**: `string`

##### argument0?

> `optional` **argument0?**: `string`

##### stateReportAddress?

> `optional` **stateReportAddress?**: `string`

##### targetFsBase?

> `optional` **targetFsBase?**: `string`

##### translatedReturnAddress?

> `optional` **translatedReturnAddress?**: `string`

##### resumeMode?

> `optional` **resumeMode?**: `"translated-frame"`

##### resumeRflags?

> `optional` **resumeRflags?**: `string`

##### resumeRegisters?

> `optional` **resumeRegisters?**: [`TargetGuestResumeRegisters`](#targetguestresumeregisters)

##### timeoutSeconds

> **timeoutSeconds**: `number`

##### stackTargetStart

> **stackTargetStart**: `string`

##### stackSize

> **stackSize**: `number`

##### stackPointer

> **stackPointer**: `string`

***

### TargetGuestTranslatedFrameDescriptor

#### Properties

##### kind

> **kind**: `"single-target-caller-frame"`

##### framePointer

> **framePointer**: `string`

##### canonicalFrameAddress

> **canonicalFrameAddress**: `string`

##### returnAddressSlot

> **returnAddressSlot**: `string`

##### returnAddress

> **returnAddress**: `string`

##### unwindId

> **unwindId**: `string`

##### calleeSaved

> **calleeSaved**: [`TargetGuestTranslatedFrameRegister`](#targetguesttranslatedframeregister)[]

##### slots

> **slots**: [`TargetGuestTranslatedFrameSlot`](#targetguesttranslatedframeslot)[]

***

### TargetGuestTranslatedFrameRegister

#### Properties

##### register

> **register**: [`TargetGuestTranslatedFrameRegisterName`](#targetguesttranslatedframeregistername)

##### value

> **value**: `string`

***

### TargetGuestTranslatedFrameSlot

#### Properties

##### offset

> **offset**: `number`

##### value

> **value**: `string`

##### classification

> **classification**: `"non-pointer-data"`

***

### TargetGuestRestoreDescriptor

#### Properties

##### kind

> **kind**: `"machinen.target-guest-restore"`

##### targetArch

> **targetArch**: `"amd64"`

##### continuation

> **continuation**: [`TargetGuestRestoreContinuationDescriptor`](#targetguestrestorecontinuationdescriptor)

##### translatedFrame?

> `optional` **translatedFrame?**: [`TargetGuestTranslatedFrameDescriptor`](#targetguesttranslatedframedescriptor)

##### resources

> **resources**: [`TargetGuestRestoreResourceRecipe`](#targetguestrestoreresourcerecipe)[]

##### memory

> **memory**: [`TargetGuestMemoryMaterializationEntry`](#targetguestmemorymaterializationentry)[]

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

> `optional` **guestArch?**: `"amd64"` \| `"arm64"` \| `"unknown"`

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

[`RestoreOptions`](#restoreoptions).[`name`](#name-12)

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

[`BootOptions`](#bootoptions).[`env`](#env-5)

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

[`BootOptions`](#bootoptions).[`cwd`](#cwd-3)

##### args?

> `optional` **args?**: `string`[]

Extra argv for the VMM.

###### Inherited from

[`BootOptions`](#bootoptions).[`args`](#args-2)

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

[`BootOptions`](#bootoptions).[`memory`](#memory-4)

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

[`BootOptions`](#bootoptions).[`env`](#env-5)

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

[`BootOptions`](#bootoptions).[`cwd`](#cwd-3)

##### args?

> `optional` **args?**: `string`[]

Extra argv for the VMM.

###### Inherited from

[`BootOptions`](#bootoptions).[`args`](#args-2)

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

[`BootOptions`](#bootoptions).[`memory`](#memory-4)

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

### ErrorCode

> **ErrorCode** = *typeof* [`ErrorCode`](#errorcode)\[keyof *typeof* [`ErrorCode`](#errorcode)\]

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

### NativeActiveSyscallClass

> **NativeActiveSyscallClass** = `"outside-syscall"` \| `"sleep-timer"` \| `"poll-timeout"` \| `"fd-blocking"` \| `"restart"` \| `"unknown-active"`

***

### NativeSleepTimerSyscallPolicy

> **NativeSleepTimerSyscallPolicy** = `"refuse"` \| `"defer-target-resume"`

***

### NativePollTimeoutSyscallPolicy

> **NativePollTimeoutSyscallPolicy** = `"refuse"` \| `"defer-target-resume"`

***

### NativePollTimeoutFdPolicy

> **NativePollTimeoutFdPolicy** = `"zero-fd-only"` \| `"synthetic-empty-pipe"` \| `"synthetic-empty-eventfd"` \| `"synthetic-timerfd"`

***

### NativeModeledPpollTargetResource

> **NativeModeledPpollTargetResource** = `"synthetic-empty-pipe-read-end"` \| `"synthetic-empty-eventfd"` \| `"synthetic-timerfd"`

***

### NativeSleepTimerModelResult

> **NativeSleepTimerModelResult** = \{ `state`: `"modeled"`; `timer`: [`NativeModeledSleepTimerState`](#nativemodeledsleeptimerstate); \} \| \{ `state`: `"missing"`; `refusal`: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal); \}

***

### NativePpollTimeoutModelResult

> **NativePpollTimeoutModelResult** = \{ `state`: `"modeled"`; `timeout`: [`NativeModeledPpollTimeoutState`](#nativemodeledppolltimeoutstate); \} \| \{ `state`: `"missing"`; `refusal`: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal); \}

***

### NativeActiveSyscallContinuation

> **NativeActiveSyscallContinuation** = [`NativeActiveSleepTimerContinuation`](#nativeactivesleeptimercontinuation) \| [`NativeActivePpollTimeoutContinuation`](#nativeactiveppolltimeoutcontinuation)

***

### NativeActualRealUtilityContinuationBoundary

> **NativeActualRealUtilityContinuationBoundary** = [`NativeRealUtilityContinuationBoundary`](#nativerealutilitycontinuationboundary) \| `"target-module-bytes"` \| `"target-caller-frame"` \| `"target-resume-execution"`

***

### NativeDebugMemoryMetadataSource

> **NativeDebugMemoryMetadataSource** = `"dwarf"` \| `"symbol"` \| `"none"`

***

### NativeDebugMemoryFieldClassification

> **NativeDebugMemoryFieldClassification** = `"integer"` \| `"pointer"` \| `"code-pointer"` \| `"unknown"`

***

### NativeMappingMaterializationAction

> **NativeMappingMaterializationAction** = `"map-target-file"` \| `"copy-captured-bytes"` \| `"recreate"` \| `"omit"` \| `"refuse"`

***

### NativeProcessImageArchitecture

> **NativeProcessImageArchitecture** = *typeof* [`nativeProcessImageArchitectures`](#nativeprocessimagearchitectures)\[`number`\]

***

### NativeProcessImageRefusalCode

> **NativeProcessImageRefusalCode** = *typeof* [`nativeProcessImageRefusalCodes`](#nativeprocessimagerefusalcodes)\[`number`\]

***

### NativeMemoryMappingKind

> **NativeMemoryMappingKind** = `"text"` \| `"data"` \| `"heap"` \| `"stack"` \| `"tls"` \| `"vdso"` \| `"vvar"` \| `"file"` \| `"anonymous"` \| `"shared"` \| `"special"`

***

### NativeRegisterState

> **NativeRegisterState** = [`NativeArm64Registers`](#nativearm64registers) \| [`NativeAmd64Registers`](#nativeamd64registers)

***

### NativeTlsThreadPointerRegister

> **NativeTlsThreadPointerRegister** = `"arm64-tpidr-el0"` \| `"amd64-fs-base"`

***

### NativeTlsAmd64SegmentBases

> **NativeTlsAmd64SegmentBases** = \{ `state`: `"not-required"`; `fsBase`: `string`; `gsBase`: `string`; `reason?`: `string`; \} \| \{ `state`: `"provided"`; `fsBase`: `string`; `gsBase`: `string`; `provenance?`: `string`; \} \| \{ `state`: `"unsupported"`; `reason?`: `string`; `refusal?`: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal); \}

***

### NativeSimdFpuLiveSubset

> **NativeSimdFpuLiveSubset** = `"fp-control-state"` \| `"caller-saved-vector-registers"` \| `"callee-saved-vector-registers"` \| `"unknown-live-state"`

***

### NativeSimdFpuState

> **NativeSimdFpuState** = \{ `state`: `"not-live"`; `provenance?`: `string`; \} \| \{ `state`: `"requires-restore"`; `arch?`: [`NativeProcessImageArchitecture`](#nativeprocessimagearchitecture); `byteLength?`: `number`; `liveSubset?`: [`NativeSimdFpuLiveSubset`](#nativesimdfpulivesubset); `reason?`: `string`; \} \| \{ `state`: `"not-captured"` \| `"unsupported"`; `reason?`: `string`; `refusal?`: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal); \}

***

### NativeProcessResourceKind

> **NativeProcessResourceKind** = `"argv"` \| `"env"` \| `"cwd"` \| `"exe"` \| `"auxv"` \| `"fd"` \| `"file"` \| `"pipe"` \| `"socket"` \| `"raw-socket"` \| `"pty"` \| `"timer"` \| `"eventfd"` \| `"signal"` \| `"namespace"` \| `"credential"` \| `"futex"` \| `"epoll"` \| `"unknown"`

***

### NativeProcessImageJsonSchema

> **NativeProcessImageJsonSchema** = `Record`\<`string`, `unknown`\>

***

### NativeRealUtilityTargetContinuationKind

> **NativeRealUtilityTargetContinuationKind** = `"sleep-timer"` \| `"poll-timeout"`

***

### NativeRealUtilityContinuationStrategy

> **NativeRealUtilityContinuationStrategy** = `"module-rva-equivalence"` \| `"semantic-sleep-timer-symbol"` \| `"synthetic-sleep-syscall"` \| `"synthetic-ppoll-syscall"`

***

### NativeRealUtilitySyntheticContinuationSelection

> **NativeRealUtilitySyntheticContinuationSelection** = \{ `kind`: `"sleep-timer"`; `source`: `"synthetic-syscall"`; `symbolName`: `"machinen_synthetic_clock_nanosleep"`; `targetRelativeAddress`: `"0x0"`; `targetAddress`: `string`; `sizeBytes`: `number`; `syscall`: [`NativeSyntheticSleepSyscallContinuation`](#nativesyntheticsleepsyscallcontinuation)\[`"syscall"`\]; `completionMode`: [`NativeSyntheticSleepCompletionMode`](#nativesyntheticsleepcompletionmode); `exitStatusOnSuccess?`: `0`; `descriptor`: [`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor); `provenance`: [`NativeSyntheticSleepSyscallContinuationProvenance`](#nativesyntheticsleepsyscallcontinuationprovenance); \} \| \{ `kind`: `"poll-timeout"`; `source`: `"synthetic-syscall"`; `symbolName`: `"machinen_synthetic_ppoll"`; `targetRelativeAddress`: `"0x0"`; `targetAddress`: `string`; `sizeBytes`: `number`; `syscall`: [`NativeSyntheticPpollSyscallContinuation`](#nativesyntheticppollsyscallcontinuation)\[`"syscall"`\]; `completionMode`: [`NativeSyntheticPpollCompletionMode`](#nativesyntheticppollcompletionmode); `exitStatusOnSuccess?`: `0`; `descriptor`: [`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor); `provenance`: [`NativeSyntheticPpollSyscallContinuationProvenance`](#nativesyntheticppollsyscallcontinuationprovenance); \}

***

### NativeRealUtilityContinuationBoundary

> **NativeRealUtilityContinuationBoundary** = `"thread-state"` \| `"resource-boundary"` \| `"mapping-materialization"` \| `"target-code-location"` \| `"source-unwind"` \| `"target-unwind"` \| `"target-frame-state"` \| `"ready"`

***

### NativeTargetFdTableEntryKind

> **NativeTargetFdTableEntryKind** = `"close-fd"` \| `"inherit-stdio"` \| `"reopen-file"` \| `"synthetic-empty-pipe-read-end"` \| `"synthetic-empty-pipe-write-end"` \| `"synthetic-empty-eventfd"` \| `"synthetic-timerfd"` \| `"refused"`

***

### NativeSimdFpuRestorePolicyResult

> **NativeSimdFpuRestorePolicyResult** = \{ `state`: `"accepted"`; `threadId`: `string`; `policy`: `"not-live"`; `refusals`: \[\]; \} \| \{ `state`: `"refused"`; `threadId`: `string`; `refusals`: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]; \}

***

### NativeSyntheticContinuationTargetArch

> **NativeSyntheticContinuationTargetArch** = `"amd64"`

***

### NativeSyntheticContinuationByteSource

> **NativeSyntheticContinuationByteSource** = `"generated-target-native-amd64-syscall-sequence"`

***

### NativeSyntheticContinuationByteEncoding

> **NativeSyntheticContinuationByteEncoding** = `"amd64-machine-code"`

***

### NativeSyntheticContinuationSyscallAbi

> **NativeSyntheticContinuationSyscallAbi** = `"linux-amd64"`

***

### NativeSyntheticContinuationRegisterSetupAbi

> **NativeSyntheticContinuationRegisterSetupAbi** = `"linux-amd64-syscall"`

***

### NativeSyntheticContinuationFailureKind

> **NativeSyntheticContinuationFailureKind** = `"signal-interrupted-unsupported"` \| `"signal-restart-unsupported"` \| `"syscall-return-unmodeled"`

***

### NativeSyntheticContinuationFailureExitBucketCondition

> **NativeSyntheticContinuationFailureExitBucketCondition** = `"equals-negative-errno"` \| `"restart-like-negative-errno"` \| `"other-negative-errno"` \| `"nonzero-return"`

***

### NativeSyntheticContinuationRegister

> **NativeSyntheticContinuationRegister** = `"rax"` \| `"rdi"` \| `"rsi"` \| `"rdx"` \| `"r10"` \| `"r8"` \| `"r9"` \| `"rcx"` \| `"r11"`

***

### NativeSyntheticContinuationProvenanceSource

> **NativeSyntheticContinuationProvenanceSource** = `"generated-target-native-amd64-syscall-sequence"` \| `"linux-amd64-syscall-abi"` \| `"modeled-source-sleep-timer"` \| `"modeled-source-ppoll-timeout"` \| `"target-caller-frame"`

***

### NativeSyntheticSyscallContinuationDescriptorPayload

> **NativeSyntheticSyscallContinuationDescriptorPayload** = `Omit`\<[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor), `"descriptorSha256"`\>

***

### NativeSyntheticPpollCompletionMode

> **NativeSyntheticPpollCompletionMode** = `"return-to-trampoline"` \| `"exit-process"`

***

### NativeSyntheticPpollSyscallProvenanceSource

> **NativeSyntheticPpollSyscallProvenanceSource** = [`NativeSyntheticContinuationProvenanceSource`](#nativesyntheticcontinuationprovenancesource)

***

### NativeSyntheticSleepCompletionMode

> **NativeSyntheticSleepCompletionMode** = `"return-to-trampoline"` \| `"exit-process"`

***

### NativeSyntheticSleepSyscallProvenanceSource

> **NativeSyntheticSleepSyscallProvenanceSource** = [`NativeSyntheticContinuationProvenanceSource`](#nativesyntheticcontinuationprovenancesource)

***

### NativeTargetFrameStateRegister

> **NativeTargetFrameStateRegister** = `Exclude`\<[`NativeTargetUnwindRegister`](#nativetargetunwindregister), `"rsp"` \| `"rip"`\>

***

### NativeTargetFrameStateValueSource

> **NativeTargetFrameStateValueSource** = `"target-register"` \| `"synthetic-target-caller"`

***

### NativeTargetLandingInstructionBoundaryState

> **NativeTargetLandingInstructionBoundaryState** = `"known-valid"` \| `"known-invalid"` \| `"unknown"`

***

### NativeTargetResumeExecutionMode

> **NativeTargetResumeExecutionMode** = `"planned-not-executed"`

***

### NativeTargetResumeExecutor

> **NativeTargetResumeExecutor** = `"native-resume-trampoline"`

***

### NativeTargetResumeExecutionAttemptStatus

> **NativeTargetResumeExecutionAttemptStatus** = `"returned"` \| `"faulted"` \| `"exited"`

***

### NativeTargetResumeFaultBoundary

> **NativeTargetResumeFaultBoundary** = `"target-resume-fault-state"`

***

### NativeTargetUnwindRegister

> **NativeTargetUnwindRegister** = `"rsp"` \| `"rbp"` \| `"rip"` \| `"rbx"` \| `"r12"` \| `"r13"` \| `"r14"` \| `"r15"`

***

### NativeTargetCalleeSavedPolicy

> **NativeTargetCalleeSavedPolicy** = `"strict"` \| `"record"`

***

### NativeThreadRestorePlan

> **NativeThreadRestorePlan** = \{ `state`: `"accepted"`; `threadId`: `string`; `targetThreadCount`: `1`; `refusals`: \[\]; \} \| \{ `state`: `"refused"`; `targetThreadCount`: `number`; `refusals`: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]; \}

***

### NativeTlsTargetAccessPolicy

> **NativeTlsTargetAccessPolicy** = `"not-required"` \| `"segment-bases-provided"` \| `"target-tcb-materialized"` \| `"target-tcb-required"`

***

### NativeTlsSegmentBaseHandoffResult

> **NativeTlsSegmentBaseHandoffResult** = \{ `state`: `"accepted"`; `threadId`: `string`; `sourceArch`: `"arm64"`; `sourceRegister`: `"arm64-tpidr-el0"`; `sourceThreadPointer`: `string`; `targetArch`: `"amd64"`; `targetSegmentBases`: \{ `fsBase`: `string`; `gsBase`: `string`; `accessPolicy`: `Exclude`\<[`NativeTlsTargetAccessPolicy`](#nativetlstargetaccesspolicy), `"target-tcb-required"`\>; \}; `refusals`: \[\]; \} \| \{ `state`: `"refused"`; `threadId`: `string`; `refusals`: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]; \}

***

### NativeUnwindMetadataKind

> **NativeUnwindMetadataKind** = `"dwarf"` \| `"eh-frame"`

***

### NativeUnwindRegister

> **NativeUnwindRegister** = `"sp"` \| `"x29"` \| `"x30"`

***

### PidStatus

> **PidStatus** = `"alive"` \| `"dead"` \| `"recycled"`

Result of `validatePid` — easy to switch on at the call site.

***

### PortableMachineVmRestoreProofState

> **PortableMachineVmRestoreProofState** = `"ready"` \| `"skipped"` \| `"refused"` \| `"completed"`

***

### PortableMachineTargetVerifierResult

> **PortableMachineTargetVerifierResult** = `"pending"` \| `"passed"` \| `"failed"`

***

### PortableMachineTargetContinuationKind

> **PortableMachineTargetContinuationKind** = `"generated-verifier"` \| `"real-utility"`

***

### PortableMachineTargetStateConsumptionResult

> **PortableMachineTargetStateConsumptionResult** = `"pending"` \| `"passed"` \| `"failed"`

***

### PortableMachineTargetReturnChainResult

> **PortableMachineTargetReturnChainResult** = `"pending"` \| `"passed"` \| `"failed"`

***

### PortableMachineTargetFrameRestoreResult

> **PortableMachineTargetFrameRestoreResult** = `"pending"` \| `"passed"` \| `"failed"`

***

### PortableMachineTargetRegisterRestoreResult

> **PortableMachineTargetRegisterRestoreResult** = `"pending"` \| `"passed"` \| `"failed"`

***

### PortableMachineTargetRflagsRestoreResult

> **PortableMachineTargetRflagsRestoreResult** = `"pending"` \| `"passed"` \| `"failed"`

***

### PortableMachineTargetTlsRestoreResult

> **PortableMachineTargetTlsRestoreResult** = `"pending"` \| `"passed"` \| `"failed"`

***

### PortableMachineTargetThreadRestoreResult

> **PortableMachineTargetThreadRestoreResult** = `"accepted"` \| `"refused"`

***

### PortableMachineTargetResumePathResult

> **PortableMachineTargetResumePathResult** = `"pending"` \| `"passed"` \| `"failed"`

***

### PortableMachineTargetRestoreDescriptorPlan

> **PortableMachineTargetRestoreDescriptorPlan** = \{ `state`: `"ready"`; `descriptor`: [`TargetGuestRestoreDescriptor`](#targetguestrestoredescriptor); `refusals`: \[\]; `memoryEntryCount`: `number`; `fdRecipeCount`: `number`; `sourceTextReusedAsTargetCode`: `false`; `sourceIsaEmulationUsed`: `false`; `sidecarRuntimeUsed`: `false`; \} \| \{ `state`: `"refused"`; `refusals`: [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]; `memoryEntryCount`: `number`; `fdRecipeCount`: `number`; `sourceTextReusedAsTargetCode`: `false`; `sourceIsaEmulationUsed`: `false`; `sidecarRuntimeUsed`: `false`; \}

***

### PortableMachineSnapshotArchitecture

> **PortableMachineSnapshotArchitecture** = *typeof* [`portableMachineSnapshotArchitectures`](#portablemachinesnapshotarchitectures)\[`number`\]

***

### PortableMachineSnapshotRefusalCode

> **PortableMachineSnapshotRefusalCode** = *typeof* [`portableMachineSnapshotRefusalCodes`](#portablemachinesnapshotrefusalcodes)\[`number`\]

***

### TargetGuestMemoryMaterializationKind

> **TargetGuestMemoryMaterializationKind** = `"copy-captured-bytes"` \| `"recreate-guard"`

***

### TargetGuestMemoryMaterializationEntry

> **TargetGuestMemoryMaterializationEntry** = [`TargetGuestCopyCapturedBytesEntry`](#targetguestcopycapturedbytesentry) \| [`TargetGuestRecreateGuardEntry`](#targetguestrecreateguardentry)

***

### TargetGuestRestoreLoaderRefusalCode

> **TargetGuestRestoreLoaderRefusalCode** = `"target-guest-loader-descriptor-invalid"` \| `"target-guest-loader-target-arch-unsupported"` \| `"target-guest-loader-resource-unsupported"` \| `"target-guest-loader-invalid-fd"` \| `"target-guest-loader-invalid-continuation"` \| `"target-guest-loader-memory-unsupported"` \| `"target-guest-loader-frame-unsupported"`

***

### TargetGuestRestoreResourceRecipe

> **TargetGuestRestoreResourceRecipe** = \{ `kind`: `"close-fd"`; `fd`: `number`; `reason?`: `string`; \} \| \{ `kind`: `"inherit-stdio"`; `fd`: `1` \| `2`; `stream`: `"stdout"` \| `"stderr"`; `closeOnExec?`: `boolean`; \} \| \{ `kind`: `"reopen-file"`; `fd`: `number`; `path`: `string`; `offset`: `number`; `access`: `0` \| `1` \| `2`; `closeOnExec?`: `boolean`; \} \| \{ `kind`: `"synthetic-empty-pipe"`; `readFd`: `number`; `writeFd?`: `number`; `closeOnExec?`: `boolean`; \} \| \{ `kind`: `"synthetic-empty-eventfd"`; `fd`: `number`; `closeOnExec?`: `boolean`; \} \| \{ `kind`: `"synthetic-timerfd"`; `fd`: `number`; `closeOnExec?`: `boolean`; \}

***

### TargetGuestRestoreResumeMode

> **TargetGuestRestoreResumeMode** = `"translated-frame"`

***

### TargetGuestResumeRegisterName

> **TargetGuestResumeRegisterName** = `"rax"` \| `"rdi"` \| `"rsi"` \| `"rdx"` \| `"rcx"` \| `"r8"` \| `"r9"` \| `"r10"` \| `"r11"`

***

### TargetGuestResumeRegisters

> **TargetGuestResumeRegisters** = `Record`\<[`TargetGuestResumeRegisterName`](#targetguestresumeregistername), `string`\>

***

### TargetGuestTranslatedFrameRegisterName

> **TargetGuestTranslatedFrameRegisterName** = `"rbx"` \| `"r12"` \| `"r13"` \| `"r14"` \| `"r15"`

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

##### BOOT\_VMSTATE\_CROSS\_ISA\_UNSUPPORTED

> `readonly` **BOOT\_VMSTATE\_CROSS\_ISA\_UNSUPPORTED**: `"BOOT_VMSTATE_CROSS_ISA_UNSUPPORTED"` = `"BOOT_VMSTATE_CROSS_ISA_UNSUPPORTED"`

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

### NATIVE\_PROCESS\_IMAGE\_FORMAT\_VERSION

> `const` **NATIVE\_PROCESS\_IMAGE\_FORMAT\_VERSION**: `1` = `1`

***

### NATIVE\_PROCESS\_IMAGE\_FILES

> `const` **NATIVE\_PROCESS\_IMAGE\_FILES**: `object`

#### Type Declaration

##### manifest

> `readonly` **manifest**: `"native-process.json"` = `"native-process.json"`

##### mappings

> `readonly` **mappings**: `"native-mappings.json"` = `"native-mappings.json"`

##### threads

> `readonly` **threads**: `"native-threads.json"` = `"native-threads.json"`

##### resources

> `readonly` **resources**: `"native-resources.json"` = `"native-resources.json"`

##### translation

> `readonly` **translation**: `"native-translation.json"` = `"native-translation.json"`

##### memory

> `readonly` **memory**: `"native-memory.bin"` = `"native-memory.bin"`

***

### nativeProcessImageArchitectures

> `const` **nativeProcessImageArchitectures**: readonly \[`"arm64"`, `"amd64"`\]

***

### nativeProcessImageRefusalCodes

> `const` **nativeProcessImageRefusalCodes**: readonly \[`"active-syscall"`, `"architecture-pair-unsupported"`, `"architecture-unsupported"`, `"blocking-syscall-state-unsupported"`, `"code-location-unknown"`, `"fd-kind-unsupported"`, `"futex-state-unsupported"`, `"inherited-stdio-policy-required"`, `"kernel-state-unsupported"`, `"mapping-ambiguous"`, `"mapping-captured-range-unsupported"`, `"mapping-executable-unsupported"`, `"mapping-permission-unsupported"`, `"mapping-provenance-ambiguous"`, `"mapping-shared-unsupported"`, `"mapping-unreadable"`, `"pointer-ambiguous"`, `"resource-kind-unsupported"`, `"non-stdio-kernel-state-unsupported"`, `"rseq-state-unsupported"`, `"signal-frame-active"`, `"signal-state-unsupported"`, `"simd-fpu-state-unsupported"`, `"stdin-buffer-state-unsupported"`, `"syscall-argument-state-unsupported"`, `"syscall-restart-unsupported"`, `"target-build-id-mismatch"`, `"target-build-mismatch"`, `"target-code-location-unresolved"`, `"target-callee-saved-state-unsupported"`, `"target-caller-frame-unavailable"`, `"target-code-rva-unmapped"`, `"target-fd-table-duplicate"`, `"target-fd-table-missing"`, `"target-frame-layout-unsupported"`, `"target-frame-register-value-unavailable"`, `"target-module-bytes-missing"`, `"target-module-file-missing"`, `"target-module-missing"`, `"target-module-not-executable"`, `"target-module-range-unreadable"`, `"target-ppoll-syscall-continuation-missing"`, `"target-ppoll-timeout-missing"`, `"target-return-slot-unsupported"`, `"target-resume-execution-unavailable"`, `"target-resume-fault-invalid-code-landing"`, `"target-resume-fault-outside-target-bytes"`, `"target-resume-fault-privileged-instruction"`, `"target-resume-fault-signal-unsupported"`, `"target-resume-fault-timeout"`, `"target-resume-fault-unmodeled-memory"`, `"target-semantic-continuation-missing"`, `"target-sleep-remaining-time-missing"`, `"target-sleep-signal-restart-unsupported"`, `"target-sleep-syscall-continuation-missing"`, `"target-stack-window-unsupported"`, `"target-synthetic-signal-interrupted-unsupported"`, `"target-synthetic-signal-restart-unsupported"`, `"target-synthetic-syscall-return-unmodeled"`, `"thread-state-unsupported"`, `"tls-state-unsupported"`, `"return-slot-unreadable"`, `"target-unwind-mismatch"`, `"unwind-fde-missing"`, `"unwind-metadata-missing"`, `"unwind-rule-unsupported"`, `"vdso-policy-unsupported"`\]

***

### nativeProcessImageSchemas

> `const` **nativeProcessImageSchemas**: `object`

#### Type Declaration

##### manifest

> `readonly` **manifest**: `object`

###### manifest.$schema

> `readonly` **$schema**: `"https://json-schema.org/draft/2020-12/schema"` = `"https://json-schema.org/draft/2020-12/schema"`

###### manifest.$id

> `readonly` **$id**: `"https://machinen.dev/schemas/native-process-image/manifest.schema.json"` = `"https://machinen.dev/schemas/native-process-image/manifest.schema.json"`

###### manifest.title

> `readonly` **title**: `"Machinen native process image manifest"` = `"Machinen native process image manifest"`

###### manifest.type

> `readonly` **type**: `"object"` = `"object"`

###### manifest.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### manifest.required

> `readonly` **required**: readonly \[`"formatVersion"`, `"kind"`, `"capture"`, `"target"`, `"process"`, `"refusals"`\]

###### manifest.properties

> `readonly` **properties**: `object`

###### manifest.properties.formatVersion

> `readonly` **formatVersion**: `object`

###### manifest.properties.formatVersion.const

> `readonly` **const**: `1` = `NATIVE_PROCESS_IMAGE_FORMAT_VERSION`

###### manifest.properties.kind

> `readonly` **kind**: `object`

###### manifest.properties.kind.const

> `readonly` **const**: `"machinen.native-process-image"` = `"machinen.native-process-image"`

###### manifest.properties.capture

> `readonly` **capture**: `object`

###### manifest.properties.capture.type

> `readonly` **type**: `"object"` = `"object"`

###### manifest.properties.capture.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### manifest.properties.capture.required

> `readonly` **required**: readonly \[`"method"`, `"sourceArch"`\]

###### manifest.properties.capture.properties

> `readonly` **properties**: `object`

###### manifest.properties.capture.properties.method

> `readonly` **method**: `object`

###### manifest.properties.capture.properties.method.const

> `readonly` **const**: `"external-ptrace-procfs"` = `"external-ptrace-procfs"`

###### manifest.properties.capture.properties.sourceArch

> `readonly` **sourceArch**: `object`

###### manifest.properties.capture.properties.sourceArch.enum

> `readonly` **enum**: readonly \[`"arm64"`, `"amd64"`\] = `nativeProcessImageArchitectures`

###### manifest.properties.capture.properties.pid

> `readonly` **pid**: `object`

###### manifest.properties.capture.properties.pid.type

> `readonly` **type**: `"integer"` = `"integer"`

###### manifest.properties.capture.properties.pid.minimum

> `readonly` **minimum**: `1` = `1`

###### manifest.properties.capture.properties.capturedAt

> `readonly` **capturedAt**: `object`

###### manifest.properties.capture.properties.capturedAt.type

> `readonly` **type**: `"string"` = `"string"`

###### manifest.properties.target

> `readonly` **target**: `object`

###### manifest.properties.target.type

> `readonly` **type**: `"object"` = `"object"`

###### manifest.properties.target.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### manifest.properties.target.required

> `readonly` **required**: readonly \[`"mode"`, `"arch"`, `"abi"`\]

###### manifest.properties.target.properties

> `readonly` **properties**: `object`

###### manifest.properties.target.properties.mode

> `readonly` **mode**: `object`

###### manifest.properties.target.properties.mode.const

> `readonly` **const**: `"native-cross-isa"` = `"native-cross-isa"`

###### manifest.properties.target.properties.arch

> `readonly` **arch**: `object`

###### manifest.properties.target.properties.arch.enum

> `readonly` **enum**: readonly \[`"arm64"`, `"amd64"`\] = `nativeProcessImageArchitectures`

###### manifest.properties.target.properties.abi

> `readonly` **abi**: `object`

###### manifest.properties.target.properties.abi.const

> `readonly` **const**: `"linux-user"` = `"linux-user"`

###### manifest.properties.process

> `readonly` **process**: `object`

###### manifest.properties.process.type

> `readonly` **type**: `"object"` = `"object"`

###### manifest.properties.process.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### manifest.properties.process.required

> `readonly` **required**: readonly \[`"exe"`, `"argv"`, `"env"`, `"cwd"`\]

###### manifest.properties.process.properties

> `readonly` **properties**: `object`

###### manifest.properties.process.properties.exe

> `readonly` **exe**: `object`

###### manifest.properties.process.properties.exe.type

> `readonly` **type**: `"string"` = `"string"`

###### manifest.properties.process.properties.exe.minLength

> `readonly` **minLength**: `1` = `1`

###### manifest.properties.process.properties.argv

> `readonly` **argv**: `object`

###### manifest.properties.process.properties.argv.type

> `readonly` **type**: `"array"` = `"array"`

###### manifest.properties.process.properties.argv.items

> `readonly` **items**: `object`

###### manifest.properties.process.properties.argv.items.type

> `readonly` **type**: `"string"` = `"string"`

###### manifest.properties.process.properties.argv.minItems

> `readonly` **minItems**: `1` = `1`

###### manifest.properties.process.properties.env

> `readonly` **env**: `object`

###### manifest.properties.process.properties.env.type

> `readonly` **type**: `"object"` = `"object"`

###### manifest.properties.process.properties.env.additionalProperties

> `readonly` **additionalProperties**: `object`

###### manifest.properties.process.properties.env.additionalProperties.type

> `readonly` **type**: `"string"` = `"string"`

###### manifest.properties.process.properties.cwd

> `readonly` **cwd**: `object`

###### manifest.properties.process.properties.cwd.type

> `readonly` **type**: `"string"` = `"string"`

###### manifest.properties.process.properties.cwd.minLength

> `readonly` **minLength**: `1` = `1`

###### manifest.properties.refusals

> `readonly` **refusals**: [`NativeProcessImageJsonSchema`](#nativeprocessimagejsonschema) = `REFUSALS_SCHEMA`

##### mappings

> `readonly` **mappings**: `object`

###### mappings.$schema

> `readonly` **$schema**: `"https://json-schema.org/draft/2020-12/schema"` = `"https://json-schema.org/draft/2020-12/schema"`

###### mappings.$id

> `readonly` **$id**: `"https://machinen.dev/schemas/native-process-image/mappings.schema.json"` = `"https://machinen.dev/schemas/native-process-image/mappings.schema.json"`

###### mappings.title

> `readonly` **title**: `"Machinen native process image mappings"` = `"Machinen native process image mappings"`

###### mappings.type

> `readonly` **type**: `"object"` = `"object"`

###### mappings.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### mappings.required

> `readonly` **required**: readonly \[`"formatVersion"`, `"mappings"`, `"refusals"`\]

###### mappings.properties

> `readonly` **properties**: `object`

###### mappings.properties.formatVersion

> `readonly` **formatVersion**: `object`

###### mappings.properties.formatVersion.const

> `readonly` **const**: `1` = `NATIVE_PROCESS_IMAGE_FORMAT_VERSION`

###### mappings.properties.mappings

> `readonly` **mappings**: `object`

###### mappings.properties.mappings.type

> `readonly` **type**: `"array"` = `"array"`

###### mappings.properties.refusals

> `readonly` **refusals**: [`NativeProcessImageJsonSchema`](#nativeprocessimagejsonschema) = `REFUSALS_SCHEMA`

##### threads

> `readonly` **threads**: `object`

###### threads.$schema

> `readonly` **$schema**: `"https://json-schema.org/draft/2020-12/schema"` = `"https://json-schema.org/draft/2020-12/schema"`

###### threads.$id

> `readonly` **$id**: `"https://machinen.dev/schemas/native-process-image/threads.schema.json"` = `"https://machinen.dev/schemas/native-process-image/threads.schema.json"`

###### threads.title

> `readonly` **title**: `"Machinen native process image threads"` = `"Machinen native process image threads"`

###### threads.type

> `readonly` **type**: `"object"` = `"object"`

###### threads.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### threads.required

> `readonly` **required**: readonly \[`"formatVersion"`, `"threads"`, `"refusals"`\]

###### threads.properties

> `readonly` **properties**: `object`

###### threads.properties.formatVersion

> `readonly` **formatVersion**: `object`

###### threads.properties.formatVersion.const

> `readonly` **const**: `1` = `NATIVE_PROCESS_IMAGE_FORMAT_VERSION`

###### threads.properties.threads

> `readonly` **threads**: `object`

###### threads.properties.threads.type

> `readonly` **type**: `"array"` = `"array"`

###### threads.properties.threads.minItems

> `readonly` **minItems**: `1` = `1`

###### threads.properties.refusals

> `readonly` **refusals**: [`NativeProcessImageJsonSchema`](#nativeprocessimagejsonschema) = `REFUSALS_SCHEMA`

##### resources

> `readonly` **resources**: `object`

###### resources.$schema

> `readonly` **$schema**: `"https://json-schema.org/draft/2020-12/schema"` = `"https://json-schema.org/draft/2020-12/schema"`

###### resources.$id

> `readonly` **$id**: `"https://machinen.dev/schemas/native-process-image/resources.schema.json"` = `"https://machinen.dev/schemas/native-process-image/resources.schema.json"`

###### resources.title

> `readonly` **title**: `"Machinen native process image resources"` = `"Machinen native process image resources"`

###### resources.type

> `readonly` **type**: `"object"` = `"object"`

###### resources.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### resources.required

> `readonly` **required**: readonly \[`"formatVersion"`, `"resources"`, `"refusals"`\]

###### resources.properties

> `readonly` **properties**: `object`

###### resources.properties.formatVersion

> `readonly` **formatVersion**: `object`

###### resources.properties.formatVersion.const

> `readonly` **const**: `1` = `NATIVE_PROCESS_IMAGE_FORMAT_VERSION`

###### resources.properties.resources

> `readonly` **resources**: `object`

###### resources.properties.resources.type

> `readonly` **type**: `"array"` = `"array"`

###### resources.properties.refusals

> `readonly` **refusals**: [`NativeProcessImageJsonSchema`](#nativeprocessimagejsonschema) = `REFUSALS_SCHEMA`

##### translation

> `readonly` **translation**: `object`

###### translation.$schema

> `readonly` **$schema**: `"https://json-schema.org/draft/2020-12/schema"` = `"https://json-schema.org/draft/2020-12/schema"`

###### translation.$id

> `readonly` **$id**: `"https://machinen.dev/schemas/native-process-image/translation.schema.json"` = `"https://machinen.dev/schemas/native-process-image/translation.schema.json"`

###### translation.title

> `readonly` **title**: `"Machinen native process image translation plan"` = `"Machinen native process image translation plan"`

###### translation.type

> `readonly` **type**: `"object"` = `"object"`

###### translation.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### translation.required

> `readonly` **required**: readonly \[`"formatVersion"`, `"mode"`, `"sourceArch"`, `"targetArch"`, `"codeLocations"`, `"threads"`, `"memoryRelocations"`, `"refusals"`\]

###### translation.properties

> `readonly` **properties**: `object`

###### translation.properties.formatVersion

> `readonly` **formatVersion**: `object`

###### translation.properties.formatVersion.const

> `readonly` **const**: `1` = `NATIVE_PROCESS_IMAGE_FORMAT_VERSION`

###### translation.properties.mode

> `readonly` **mode**: `object`

###### translation.properties.mode.const

> `readonly` **const**: `"native-cross-isa"` = `"native-cross-isa"`

###### translation.properties.sourceArch

> `readonly` **sourceArch**: `object`

###### translation.properties.sourceArch.enum

> `readonly` **enum**: readonly \[`"arm64"`, `"amd64"`\] = `nativeProcessImageArchitectures`

###### translation.properties.targetArch

> `readonly` **targetArch**: `object`

###### translation.properties.targetArch.enum

> `readonly` **enum**: readonly \[`"arm64"`, `"amd64"`\] = `nativeProcessImageArchitectures`

###### translation.properties.codeLocations

> `readonly` **codeLocations**: `object`

###### translation.properties.codeLocations.type

> `readonly` **type**: `"array"` = `"array"`

###### translation.properties.threads

> `readonly` **threads**: `object`

###### translation.properties.threads.type

> `readonly` **type**: `"array"` = `"array"`

###### translation.properties.memoryRelocations

> `readonly` **memoryRelocations**: `object`

###### translation.properties.memoryRelocations.type

> `readonly` **type**: `"array"` = `"array"`

###### translation.properties.refusals

> `readonly` **refusals**: [`NativeProcessImageJsonSchema`](#nativeprocessimagejsonschema) = `REFUSALS_SCHEMA`

***

### NATIVE\_SIMD\_FPU\_LIVE\_SUBSET\_POLICY

> `const` **NATIVE\_SIMD\_FPU\_LIVE\_SUBSET\_POLICY**: [`NativeSimdFpuLiveSubsetPolicy`](#nativesimdfpulivesubsetpolicy)

***

### NATIVE\_SYNTHETIC\_SYSCALL\_EINTR\_EXIT\_STATUS

> `const` **NATIVE\_SYNTHETIC\_SYSCALL\_EINTR\_EXIT\_STATUS**: `110` = `110`

***

### NATIVE\_SYNTHETIC\_SYSCALL\_RESTART\_EXIT\_STATUS

> `const` **NATIVE\_SYNTHETIC\_SYSCALL\_RESTART\_EXIT\_STATUS**: `111` = `111`

***

### NATIVE\_SYNTHETIC\_SYSCALL\_UNMODELED\_RETURN\_EXIT\_STATUS

> `const` **NATIVE\_SYNTHETIC\_SYSCALL\_UNMODELED\_RETURN\_EXIT\_STATUS**: `112` = `112`

***

### NATIVE\_SYNTHETIC\_PPOLL\_SYSCALL\_BUILD\_ID

> `const` **NATIVE\_SYNTHETIC\_PPOLL\_SYSCALL\_BUILD\_ID**: `"machinen-synthetic-ppoll-syscall-v2"` = `"machinen-synthetic-ppoll-syscall-v2"`

***

### NATIVE\_SYNTHETIC\_PPOLL\_SYSCALL\_LOGICAL\_NAME

> `const` **NATIVE\_SYNTHETIC\_PPOLL\_SYSCALL\_LOGICAL\_NAME**: `"machinen-synthetic-ppoll-syscall"` = `"machinen-synthetic-ppoll-syscall"`

***

### NATIVE\_SYNTHETIC\_PPOLL\_SYSCALL\_PATH

> `const` **NATIVE\_SYNTHETIC\_PPOLL\_SYSCALL\_PATH**: `"machinen.synthetic://ppoll-syscall"` = `"machinen.synthetic://ppoll-syscall"`

***

### NATIVE\_SYNTHETIC\_PPOLL\_SYSCALL\_BASE

> `const` **NATIVE\_SYNTHETIC\_PPOLL\_SYSCALL\_BASE**: `"0x700300000000"` = `"0x700300000000"`

***

### NATIVE\_SYNTHETIC\_SLEEP\_SYSCALL\_BUILD\_ID

> `const` **NATIVE\_SYNTHETIC\_SLEEP\_SYSCALL\_BUILD\_ID**: `"machinen-synthetic-sleep-syscall-v4"` = `"machinen-synthetic-sleep-syscall-v4"`

***

### NATIVE\_SYNTHETIC\_SLEEP\_SYSCALL\_LOGICAL\_NAME

> `const` **NATIVE\_SYNTHETIC\_SLEEP\_SYSCALL\_LOGICAL\_NAME**: `"machinen-synthetic-sleep-syscall"` = `"machinen-synthetic-sleep-syscall"`

***

### NATIVE\_SYNTHETIC\_SLEEP\_SYSCALL\_PATH

> `const` **NATIVE\_SYNTHETIC\_SLEEP\_SYSCALL\_PATH**: `"machinen.synthetic://sleep-syscall"` = `"machinen.synthetic://sleep-syscall"`

***

### NATIVE\_SYNTHETIC\_SLEEP\_SYSCALL\_BASE

> `const` **NATIVE\_SYNTHETIC\_SLEEP\_SYSCALL\_BASE**: `"0x700200000000"` = `"0x700200000000"`

***

### NATIVE\_SYNTHETIC\_SLEEP\_SYSCALL\_EINTR\_EXIT\_STATUS

> `const` **NATIVE\_SYNTHETIC\_SLEEP\_SYSCALL\_EINTR\_EXIT\_STATUS**: `110` = `NATIVE_SYNTHETIC_SYSCALL_EINTR_EXIT_STATUS`

***

### NATIVE\_SYNTHETIC\_SLEEP\_SYSCALL\_RESTART\_EXIT\_STATUS

> `const` **NATIVE\_SYNTHETIC\_SLEEP\_SYSCALL\_RESTART\_EXIT\_STATUS**: `111` = `NATIVE_SYNTHETIC_SYSCALL_RESTART_EXIT_STATUS`

***

### NATIVE\_SYNTHETIC\_SLEEP\_SYSCALL\_UNMODELED\_RETURN\_EXIT\_STATUS

> `const` **NATIVE\_SYNTHETIC\_SLEEP\_SYSCALL\_UNMODELED\_RETURN\_EXIT\_STATUS**: `112` = `NATIVE_SYNTHETIC_SYSCALL_UNMODELED_RETURN_EXIT_STATUS`

***

### NATIVE\_SYNTHETIC\_SLEEP\_SYSCALL\_FAILURE\_EXIT\_STATUS

> `const` **NATIVE\_SYNTHETIC\_SLEEP\_SYSCALL\_FAILURE\_EXIT\_STATUS**: `111` = `NATIVE_SYNTHETIC_SLEEP_SYSCALL_RESTART_EXIT_STATUS`

***

### PORTABLE\_MACHINE\_SNAPSHOT\_FORMAT\_VERSION

> `const` **PORTABLE\_MACHINE\_SNAPSHOT\_FORMAT\_VERSION**: `1` = `1`

***

### PORTABLE\_MACHINE\_SNAPSHOT\_FILES

> `const` **PORTABLE\_MACHINE\_SNAPSHOT\_FILES**: `object`

#### Type Declaration

##### manifest

> `readonly` **manifest**: `"portable-machine.json"` = `"portable-machine.json"`

##### nativeProcessImage

> `readonly` **nativeProcessImage**: `"native-process"` = `"native-process"`

***

### portableMachineSnapshotArchitectures

> `const` **portableMachineSnapshotArchitectures**: readonly \[`"arm64"`, `"amd64"`\]

***

### portableMachineSnapshotRefusalCodes

> `const` **portableMachineSnapshotRefusalCodes**: readonly \[`"cross-isa-vmstate-restore-unsupported"`, `"raw-vcpu-state-unsupported"`, `"raw-kernel-state-unsupported"`, `"raw-device-state-unsupported"`, `"target-isa-vm-restore-loader-missing"`, `"portable-process-image-missing"`\]

***

### portableMachineSnapshotManifestSchema

> `const` **portableMachineSnapshotManifestSchema**: `object`

#### Type Declaration

##### $schema

> `readonly` **$schema**: `"https://json-schema.org/draft/2020-12/schema"` = `"https://json-schema.org/draft/2020-12/schema"`

##### $id

> `readonly` **$id**: `"https://machinen.dev/schemas/portable-machine-snapshot/manifest.schema.json"` = `"https://machinen.dev/schemas/portable-machine-snapshot/manifest.schema.json"`

##### title

> `readonly` **title**: `"Machinen portable machine snapshot manifest"` = `"Machinen portable machine snapshot manifest"`

##### type

> `readonly` **type**: `"object"` = `"object"`

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### required

> `readonly` **required**: readonly \[`"formatVersion"`, `"kind"`, `"source"`, `"target"`, `"payload"`, `"refusals"`\]

##### properties

> `readonly` **properties**: `object`

###### properties.formatVersion

> `readonly` **formatVersion**: `object`

###### properties.formatVersion.const

> `readonly` **const**: `1` = `PORTABLE_MACHINE_SNAPSHOT_FORMAT_VERSION`

###### properties.kind

> `readonly` **kind**: `object`

###### properties.kind.const

> `readonly` **const**: `"machinen.portable-machine-snapshot"` = `"machinen.portable-machine-snapshot"`

###### properties.source

> `readonly` **source**: `object`

###### properties.source.type

> `readonly` **type**: `"object"` = `"object"`

###### properties.source.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.source.required

> `readonly` **required**: readonly \[`"guestArch"`, `"vmstate"`, `"kernelState"`, `"deviceState"`\]

###### properties.source.properties

> `readonly` **properties**: `object`

###### properties.source.properties.guestArch

> `readonly` **guestArch**: `object`

###### properties.source.properties.guestArch.enum

> `readonly` **enum**: readonly \[`"arm64"`, `"amd64"`\] = `portableMachineSnapshotArchitectures`

###### properties.source.properties.vmstate

> `readonly` **vmstate**: `object`

###### properties.source.properties.vmstate.type

> `readonly` **type**: `"object"` = `"object"`

###### properties.source.properties.vmstate.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.source.properties.vmstate.required

> `readonly` **required**: readonly \[`"rawRestore"`, `"refusalCode"`, `"reason"`\]

###### properties.source.properties.vmstate.properties

> `readonly` **properties**: `object`

###### properties.source.properties.vmstate.properties.rawRestore

> `readonly` **rawRestore**: `object`

###### properties.source.properties.vmstate.properties.rawRestore.const

> `readonly` **const**: `"refused"` = `"refused"`

###### properties.source.properties.vmstate.properties.refusalCode

> `readonly` **refusalCode**: `object`

###### properties.source.properties.vmstate.properties.refusalCode.const

> `readonly` **const**: `"cross-isa-vmstate-restore-unsupported"` = `"cross-isa-vmstate-restore-unsupported"`

###### properties.source.properties.vmstate.properties.reason

> `readonly` **reason**: `object`

###### properties.source.properties.vmstate.properties.reason.type

> `readonly` **type**: `"string"` = `"string"`

###### properties.source.properties.vmstate.properties.reason.minLength

> `readonly` **minLength**: `1` = `1`

###### properties.source.properties.kernelState

> `readonly` **kernelState**: `object`

###### properties.source.properties.kernelState.const

> `readonly` **const**: `"not-translated"` = `"not-translated"`

###### properties.source.properties.deviceState

> `readonly` **deviceState**: `object`

###### properties.source.properties.deviceState.const

> `readonly` **const**: `"not-translated"` = `"not-translated"`

###### properties.target

> `readonly` **target**: `object`

###### properties.target.type

> `readonly` **type**: `"object"` = `"object"`

###### properties.target.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.target.required

> `readonly` **required**: readonly \[`"guestArch"`, `"mode"`, `"execution"`\]

###### properties.target.properties

> `readonly` **properties**: `object`

###### properties.target.properties.guestArch

> `readonly` **guestArch**: `object`

###### properties.target.properties.guestArch.enum

> `readonly` **enum**: readonly \[`"arm64"`, `"amd64"`\] = `portableMachineSnapshotArchitectures`

###### properties.target.properties.mode

> `readonly` **mode**: `object`

###### properties.target.properties.mode.const

> `readonly` **const**: `"target-isa-vm-process-restore"` = `"target-isa-vm-process-restore"`

###### properties.target.properties.execution

> `readonly` **execution**: `object`

###### properties.target.properties.execution.const

> `readonly` **const**: `"target-native"` = `"target-native"`

###### properties.payload

> `readonly` **payload**: `object`

###### properties.payload.type

> `readonly` **type**: `"object"` = `"object"`

###### properties.payload.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.payload.required

> `readonly` **required**: readonly \[`"nativeProcessImage"`, `"resourceModel"`\]

###### properties.payload.properties

> `readonly` **properties**: `object`

###### properties.payload.properties.nativeProcessImage

> `readonly` **nativeProcessImage**: `object`

###### properties.payload.properties.nativeProcessImage.type

> `readonly` **type**: `"object"` = `"object"`

###### properties.payload.properties.nativeProcessImage.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.payload.properties.nativeProcessImage.required

> `readonly` **required**: readonly \[`"kind"`, `"path"`\]

###### properties.payload.properties.nativeProcessImage.properties

> `readonly` **properties**: `object`

###### properties.payload.properties.nativeProcessImage.properties.kind

> `readonly` **kind**: `object`

###### properties.payload.properties.nativeProcessImage.properties.kind.const

> `readonly` **const**: `"machinen.native-process-image"` = `"machinen.native-process-image"`

###### properties.payload.properties.nativeProcessImage.properties.path

> `readonly` **path**: `object`

###### properties.payload.properties.nativeProcessImage.properties.path.type

> `readonly` **type**: `"string"` = `"string"`

###### properties.payload.properties.nativeProcessImage.properties.path.minLength

> `readonly` **minLength**: `1` = `1`

###### properties.payload.properties.resourceModel

> `readonly` **resourceModel**: `object`

###### properties.payload.properties.resourceModel.const

> `readonly` **const**: `"explicit-recipes-only"` = `"explicit-recipes-only"`

###### properties.refusals

> `readonly` **refusals**: `object`

###### properties.refusals.type

> `readonly` **type**: `"object"` = `"object"`

###### properties.refusals.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.refusals.required

> `readonly` **required**: readonly \[`"vocabularyVersion"`, `"refusals"`\]

###### properties.refusals.properties

> `readonly` **properties**: `object`

###### properties.refusals.properties.vocabularyVersion

> `readonly` **vocabularyVersion**: `object`

###### properties.refusals.properties.vocabularyVersion.const

> `readonly` **const**: `1` = `1`

###### properties.refusals.properties.refusals

> `readonly` **refusals**: `object`

###### properties.refusals.properties.refusals.type

> `readonly` **type**: `"array"` = `"array"`

###### properties.refusals.properties.refusals.items

> `readonly` **items**: `object`

###### properties.refusals.properties.refusals.items.type

> `readonly` **type**: `"object"` = `"object"`

###### properties.refusals.properties.refusals.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.refusals.properties.refusals.items.required

> `readonly` **required**: readonly \[`"code"`, `"message"`\]

###### properties.refusals.properties.refusals.items.properties

> `readonly` **properties**: `object`

###### properties.refusals.properties.refusals.items.properties.code

> `readonly` **code**: `object`

###### properties.refusals.properties.refusals.items.properties.code.enum

> `readonly` **enum**: readonly \[`"cross-isa-vmstate-restore-unsupported"`, `"raw-vcpu-state-unsupported"`, `"raw-kernel-state-unsupported"`, `"raw-device-state-unsupported"`, `"target-isa-vm-restore-loader-missing"`, `"portable-process-image-missing"`\] = `portableMachineSnapshotRefusalCodes`

###### properties.refusals.properties.refusals.items.properties.message

> `readonly` **message**: `object`

###### properties.refusals.properties.refusals.items.properties.message.type

> `readonly` **type**: `"string"` = `"string"`

###### properties.refusals.properties.refusals.items.properties.message.minLength

> `readonly` **minLength**: `1` = `1`

###### properties.refusals.properties.refusals.items.properties.detail

> `readonly` **detail**: `object`

###### properties.refusals.properties.refusals.items.properties.detail.type

> `readonly` **type**: `"object"` = `"object"`

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

### TARGET\_GUEST\_RESTORE\_DESCRIPTOR\_KIND

> `const` **TARGET\_GUEST\_RESTORE\_DESCRIPTOR\_KIND**: `"machinen.target-guest-restore"` = `"machinen.target-guest-restore"`

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

### classifyNativeActiveSyscalls()

> **classifyNativeActiveSyscalls**(`threads`, `options?`): [`NativeActiveSyscallClassificationResult`](#nativeactivesyscallclassificationresult)

#### Parameters

##### threads

[`NativeThreadState`](#nativethreadstate)[]

##### options?

[`NativeActiveSyscallPolicyOptions`](#nativeactivesyscallpolicyoptions) = `{}`

#### Returns

[`NativeActiveSyscallClassificationResult`](#nativeactivesyscallclassificationresult)

***

### classifyNativeThreadSyscall()

> **classifyNativeThreadSyscall**(`thread`, `options?`): [`NativeActiveSyscallClassification`](#nativeactivesyscallclassification)

#### Parameters

##### thread

[`NativeThreadState`](#nativethreadstate)

##### options?

[`NativeActiveSyscallPolicyOptions`](#nativeactivesyscallpolicyoptions) = `{}`

#### Returns

[`NativeActiveSyscallClassification`](#nativeactivesyscallclassification)

***

### modelNativePpollTimeoutState()

> **modelNativePpollTimeoutState**(`thread`, `documents?`, `fdPolicy?`): [`NativePpollTimeoutModelResult`](#nativeppolltimeoutmodelresult)

#### Parameters

##### thread

[`NativeThreadState`](#nativethreadstate)

##### documents?

[`NativeProcessImageDocuments`](#nativeprocessimagedocuments)

##### fdPolicy?

[`NativePollTimeoutFdPolicy`](#nativepolltimeoutfdpolicy) = `"zero-fd-only"`

#### Returns

[`NativePpollTimeoutModelResult`](#nativeppolltimeoutmodelresult)

***

### modelNativeSleepTimerState()

> **modelNativeSleepTimerState**(`thread`, `documents?`): [`NativeSleepTimerModelResult`](#nativesleeptimermodelresult)

#### Parameters

##### thread

[`NativeThreadState`](#nativethreadstate)

##### documents?

[`NativeProcessImageDocuments`](#nativeprocessimagedocuments)

#### Returns

[`NativeSleepTimerModelResult`](#nativesleeptimermodelresult)

***

### planNativeActualRealUtilityContinuationAttempt()

> **planNativeActualRealUtilityContinuationAttempt**(`request`): [`NativeActualRealUtilityContinuationPlan`](#nativeactualrealutilitycontinuationplan)

#### Parameters

##### request

[`NativeActualRealUtilityContinuationRequest`](#nativeactualrealutilitycontinuationrequest)

#### Returns

[`NativeActualRealUtilityContinuationPlan`](#nativeactualrealutilitycontinuationplan)

***

### inventoryNativeActualTargetModules()

> **inventoryNativeActualTargetModules**(`request`): [`NativeActualTargetModuleInventoryResult`](#nativeactualtargetmoduleinventoryresult)

#### Parameters

##### request

[`NativeActualTargetModuleInventoryRequest`](#nativeactualtargetmoduleinventoryrequest)

#### Returns

[`NativeActualTargetModuleInventoryResult`](#nativeactualtargetmoduleinventoryresult)

***

### buildNativeCodeMap()

> **buildNativeCodeMap**(`request`): [`NativeCodeMapResult`](#nativecodemapresult)

#### Parameters

##### request

[`NativeCodeMapRequest`](#nativecodemaprequest)

#### Returns

[`NativeCodeMapResult`](#nativecodemapresult)

***

### classifyNativeDebugMemoryPointers()

> **classifyNativeDebugMemoryPointers**(`request`): [`NativeDebugMemoryPointerClassificationResult`](#nativedebugmemorypointerclassificationresult)

#### Parameters

##### request

[`NativeDebugMemoryPointerClassificationRequest`](#nativedebugmemorypointerclassificationrequest)

#### Returns

[`NativeDebugMemoryPointerClassificationResult`](#nativedebugmemorypointerclassificationresult)

***

### planNativeMappingMaterialization()

> **planNativeMappingMaterialization**(`request`): [`NativeMappingMaterializationResult`](#nativemappingmaterializationresult)

#### Parameters

##### request

[`NativeMappingMaterializationRequest`](#nativemappingmaterializationrequest)

#### Returns

[`NativeMappingMaterializationResult`](#nativemappingmaterializationresult)

***

### translateNativeMemory()

> **translateNativeMemory**(`request`): [`NativeMemoryTranslationResult`](#nativememorytranslationresult)

#### Parameters

##### request

[`NativeMemoryTranslationRequest`](#nativememorytranslationrequest)

#### Returns

[`NativeMemoryTranslationResult`](#nativememorytranslationresult)

***

### isNativeProcessImageBundle()

> **isNativeProcessImageBundle**(`dir`): `boolean`

#### Parameters

##### dir

`string`

#### Returns

`boolean`

***

### validateNativeProcessImageBundle()

> **validateNativeProcessImageBundle**(`dir`): [`NativeProcessImageDocuments`](#nativeprocessimagedocuments)

#### Parameters

##### dir

`string`

#### Returns

[`NativeProcessImageDocuments`](#nativeprocessimagedocuments)

***

### validateNativeProcessImageDocuments()

> **validateNativeProcessImageDocuments**(`docs`, `opts?`): `string`[]

#### Parameters

##### docs

[`NativeProcessImageDocumentInput`](#nativeprocessimagedocumentinput)

##### opts?

###### rootDir?

`string`

#### Returns

`string`[]

***

### assertNativeProcessImageDocuments()

> **assertNativeProcessImageDocuments**(`docs`, `opts?`): `asserts docs is NativeProcessImageDocuments`

#### Parameters

##### docs

[`NativeProcessImageDocumentInput`](#nativeprocessimagedocumentinput)

##### opts?

###### rootDir?

`string`

#### Returns

`asserts docs is NativeProcessImageDocuments`

***

### inventoryNativeSourceCodeModules()

> **inventoryNativeSourceCodeModules**(`documents`): [`NativeRealUtilitySourceModule`](#nativerealutilitysourcemodule)[]

#### Parameters

##### documents

[`NativeProcessImageDocuments`](#nativeprocessimagedocuments)

#### Returns

[`NativeRealUtilitySourceModule`](#nativerealutilitysourcemodule)[]

***

### resolveNativeRealUtilityCodeLocations()

> **resolveNativeRealUtilityCodeLocations**(`request`): [`NativeRealUtilityCodeLocationResult`](#nativerealutilitycodelocationresult)

#### Parameters

##### request

[`NativeRealUtilityCodeLocationRequest`](#nativerealutilitycodelocationrequest)

#### Returns

[`NativeRealUtilityCodeLocationResult`](#nativerealutilitycodelocationresult)

***

### planNativeRealUtilityContinuationAttempt()

> **planNativeRealUtilityContinuationAttempt**(`request`): [`NativeRealUtilityContinuationPlan`](#nativerealutilitycontinuationplan)

#### Parameters

##### request

[`NativeRealUtilityContinuationRequest`](#nativerealutilitycontinuationrequest)

#### Returns

[`NativeRealUtilityContinuationPlan`](#nativerealutilitycontinuationplan)

***

### translateNativeRegisterState()

> **translateNativeRegisterState**(`request`): [`NativeRegisterTranslationResult`](#nativeregistertranslationresult)

#### Parameters

##### request

[`NativeRegisterTranslationRequest`](#nativeregistertranslationrequest)

#### Returns

[`NativeRegisterTranslationResult`](#nativeregistertranslationresult)

***

### translateNativeResources()

> **translateNativeResources**(`request`): [`NativeResourceTranslationResult`](#nativeresourcetranslationresult)

#### Parameters

##### request

[`NativeResourceTranslationRequest`](#nativeresourcetranslationrequest)

#### Returns

[`NativeResourceTranslationResult`](#nativeresourcetranslationresult)

***

### planNativeTargetFdTable()

> **planNativeTargetFdTable**(`request`): [`NativeTargetFdTablePlan`](#nativetargetfdtableplan)

#### Parameters

##### request

[`NativeTargetFdTablePlanRequest`](#nativetargetfdtableplanrequest)

#### Returns

[`NativeTargetFdTablePlan`](#nativetargetfdtableplan)

***

### planNativeReturnChain()

> **planNativeReturnChain**(`request`): [`NativeReturnChainPlan`](#nativereturnchainplan)

#### Parameters

##### request

[`NativeReturnChainPlanRequest`](#nativereturnchainplanrequest)

#### Returns

[`NativeReturnChainPlan`](#nativereturnchainplan)

***

### planNativeSimdFpuLiveSubsetPolicy()

> **planNativeSimdFpuLiveSubsetPolicy**(): [`NativeSimdFpuLiveSubsetPolicy`](#nativesimdfpulivesubsetpolicy)

#### Returns

[`NativeSimdFpuLiveSubsetPolicy`](#nativesimdfpulivesubsetpolicy)

***

### planNativeSimdFpuRestorePolicy()

> **planNativeSimdFpuRestorePolicy**(`thread`): [`NativeSimdFpuRestorePolicyResult`](#nativesimdfpurestorepolicyresult)

#### Parameters

##### thread

[`NativeThreadState`](#nativethreadstate)

#### Returns

[`NativeSimdFpuRestorePolicyResult`](#nativesimdfpurestorepolicyresult)

***

### safeSimdFpuRefusal()

> **safeSimdFpuRefusal**(`thread`): [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

#### Parameters

##### thread

[`NativeThreadState`](#nativethreadstate)

#### Returns

[`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

***

### translateNativeStack()

> **translateNativeStack**(`request`): [`NativeStackTranslationResult`](#nativestacktranslationresult)

#### Parameters

##### request

[`NativeStackTranslationRequest`](#nativestacktranslationrequest)

#### Returns

[`NativeStackTranslationResult`](#nativestacktranslationresult)

***

### planNativeStackWindowMaterialization()

> **planNativeStackWindowMaterialization**(`request`): [`NativeStackWindowMaterializationPlan`](#nativestackwindowmaterializationplan)

#### Parameters

##### request

[`NativeStackWindowMaterializationRequest`](#nativestackwindowmaterializationrequest)

#### Returns

[`NativeStackWindowMaterializationPlan`](#nativestackwindowmaterializationplan)

***

### buildNativeSyntheticSyscallContinuationDescriptor()

> **buildNativeSyntheticSyscallContinuationDescriptor**(`request`): [`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor)

#### Parameters

##### request

[`NativeSyntheticSyscallContinuationDescriptorRequest`](#nativesyntheticsyscallcontinuationdescriptorrequest)

#### Returns

[`NativeSyntheticSyscallContinuationDescriptor`](#nativesyntheticsyscallcontinuationdescriptor)

***

### nativeSyntheticContinuationBytesHex()

> **nativeSyntheticContinuationBytesHex**(`bytes`): `string`

#### Parameters

##### bytes

`Uint8Array`

#### Returns

`string`

***

### nativeSyntheticContinuationBytesSha256()

> **nativeSyntheticContinuationBytesSha256**(`bytes`): `string`

#### Parameters

##### bytes

`Uint8Array`

#### Returns

`string`

***

### nativeSyntheticContinuationDescriptorSha256()

> **nativeSyntheticContinuationDescriptorSha256**(`descriptor`): `string`

#### Parameters

##### descriptor

[`NativeSyntheticSyscallContinuationDescriptorPayload`](#nativesyntheticsyscallcontinuationdescriptorpayload)

#### Returns

`string`

***

### nativeSyntheticEintrErrno()

> **nativeSyntheticEintrErrno**(): `object`

#### Returns

`object`

##### errno

> **errno**: `number`

##### errnoName

> **errnoName**: `string`

***

### nativeSyntheticRestartLikeErrnos()

> **nativeSyntheticRestartLikeErrnos**(): `object`[]

#### Returns

`object`[]

***

### nativeSyntheticSyscallRestartContract()

> **nativeSyntheticSyscallRestartContract**(): [`NativeSyntheticContinuationRestartContract`](#nativesyntheticcontinuationrestartcontract)

#### Returns

[`NativeSyntheticContinuationRestartContract`](#nativesyntheticcontinuationrestartcontract)

***

### nativeSyntheticSyscallFailureExitBuckets()

> **nativeSyntheticSyscallFailureExitBuckets**(`syscallName`): [`NativeSyntheticContinuationFailureExitBucket`](#nativesyntheticcontinuationfailureexitbucket)[]

#### Parameters

##### syscallName

`string`

#### Returns

[`NativeSyntheticContinuationFailureExitBucket`](#nativesyntheticcontinuationfailureexitbucket)[]

***

### nativeSyntheticExitProcessSuffix()

> **nativeSyntheticExitProcessSuffix**(): `number`[]

#### Returns

`number`[]

***

### buildNativeSyntheticPpollSyscallContinuation()

> **buildNativeSyntheticPpollSyscallContinuation**(`request`): [`NativeSyntheticPpollSyscallContinuationResult`](#nativesyntheticppollsyscallcontinuationresult)

#### Parameters

##### request

[`NativeSyntheticPpollSyscallContinuationRequest`](#nativesyntheticppollsyscallcontinuationrequest)

#### Returns

[`NativeSyntheticPpollSyscallContinuationResult`](#nativesyntheticppollsyscallcontinuationresult)

***

### buildNativeSyntheticSleepSyscallContinuation()

> **buildNativeSyntheticSleepSyscallContinuation**(`request`): [`NativeSyntheticSleepSyscallContinuationResult`](#nativesyntheticsleepsyscallcontinuationresult)

#### Parameters

##### request

[`NativeSyntheticSleepSyscallContinuationRequest`](#nativesyntheticsleepsyscallcontinuationrequest)

#### Returns

[`NativeSyntheticSleepSyscallContinuationResult`](#nativesyntheticsleepsyscallcontinuationresult)

***

### planNativeSyntheticTargetCallerFrame()

> **planNativeSyntheticTargetCallerFrame**(`request`): [`NativeSyntheticTargetCallerFramePlanResult`](#nativesynthetictargetcallerframeplanresult)

#### Parameters

##### request

[`NativeSyntheticTargetCallerFramePlanRequest`](#nativesynthetictargetcallerframeplanrequest)

#### Returns

[`NativeSyntheticTargetCallerFramePlanResult`](#nativesynthetictargetcallerframeplanresult)

***

### planNativeTargetFrameStateMaterialization()

> **planNativeTargetFrameStateMaterialization**(`request`): [`NativeTargetFrameStateMaterializationResult`](#nativetargetframestatematerializationresult)

#### Parameters

##### request

[`NativeTargetFrameStateMaterializationRequest`](#nativetargetframestatematerializationrequest)

#### Returns

[`NativeTargetFrameStateMaterializationResult`](#nativetargetframestatematerializationresult)

***

### inspectNativeTargetResumeLanding()

> **inspectNativeTargetResumeLanding**(`request`): [`NativeTargetResumeLandingProvenance`](#nativetargetresumelandingprovenance)

#### Parameters

##### request

[`NativeTargetResumeLandingInspectionRequest`](#nativetargetresumelandinginspectionrequest)

#### Returns

[`NativeTargetResumeLandingProvenance`](#nativetargetresumelandingprovenance)

***

### nativeTargetResumeLandingRefusals()

> **nativeTargetResumeLandingRefusals**(`provenances`): [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

#### Parameters

##### provenances

[`NativeTargetResumeLandingProvenance`](#nativetargetresumelandingprovenance)[]

#### Returns

[`NativeProcessImageRefusal`](#nativeprocessimagerefusal)[]

***

### materializeNativeTargetModuleBytes()

> **materializeNativeTargetModuleBytes**(`request`): [`NativeTargetModuleByteMaterializationResult`](#nativetargetmodulebytematerializationresult)

#### Parameters

##### request

[`NativeTargetModuleByteMaterializationRequest`](#nativetargetmodulebytematerializationrequest)

#### Returns

[`NativeTargetModuleByteMaterializationResult`](#nativetargetmodulebytematerializationresult)

***

### planNativeTargetResumeExecution()

> **planNativeTargetResumeExecution**(`request`): [`NativeTargetResumeExecutionPlanResult`](#nativetargetresumeexecutionplanresult)

#### Parameters

##### request

[`NativeTargetResumeExecutionPlanRequest`](#nativetargetresumeexecutionplanrequest)

#### Returns

[`NativeTargetResumeExecutionPlanResult`](#nativetargetresumeexecutionplanresult)

***

### classifyNativeTargetResumeExecutionAttempt()

> **classifyNativeTargetResumeExecutionAttempt**(`attempt`, `options?`): [`NativeTargetResumeFaultClassificationResult`](#nativetargetresumefaultclassificationresult)

#### Parameters

##### attempt

[`NativeTargetResumeExecutionAttempt`](#nativetargetresumeexecutionattempt)

##### options?

[`NativeTargetResumeFaultClassificationOptions`](#nativetargetresumefaultclassificationoptions) = `{}`

#### Returns

[`NativeTargetResumeFaultClassificationResult`](#nativetargetresumefaultclassificationresult)

***

### parseNativeTargetEhFrameText()

> **parseNativeTargetEhFrameText**(`request`): [`NativeTargetEhFrameTextParseResult`](#nativetargetehframetextparseresult)

#### Parameters

##### request

[`NativeTargetEhFrameTextParseRequest`](#nativetargetehframetextparserequest)

#### Returns

[`NativeTargetEhFrameTextParseResult`](#nativetargetehframetextparseresult)

***

### matchNativeTargetUnwindFrame()

> **matchNativeTargetUnwindFrame**(`request`): [`NativeTargetUnwindMatchResult`](#nativetargetunwindmatchresult)

#### Parameters

##### request

[`NativeTargetUnwindMatchRequest`](#nativetargetunwindmatchrequest)

#### Returns

[`NativeTargetUnwindMatchResult`](#nativetargetunwindmatchresult)

***

### planNativeThreadRestoreBoundary()

> **planNativeThreadRestoreBoundary**(`request`): [`NativeThreadRestorePlan`](#nativethreadrestoreplan)

#### Parameters

##### request

[`NativeThreadRestorePlanRequest`](#nativethreadrestoreplanrequest)

#### Returns

[`NativeThreadRestorePlan`](#nativethreadrestoreplan)

***

### planNativeTlsSegmentBaseHandoff()

> **planNativeTlsSegmentBaseHandoff**(`request`): [`NativeTlsSegmentBaseHandoffResult`](#nativetlssegmentbasehandoffresult)

#### Parameters

##### request

[`NativeTlsSegmentBaseHandoffRequest`](#nativetlssegmentbasehandoffrequest)

#### Returns

[`NativeTlsSegmentBaseHandoffResult`](#nativetlssegmentbasehandoffresult)

***

### safeTlsSegmentBaseRefusal()

> **safeTlsSegmentBaseRefusal**(`request`): [`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

#### Parameters

##### request

[`NativeThreadTlsPolicyRequest`](#nativethreadtlspolicyrequest)

#### Returns

[`NativeProcessImageRefusal`](#nativeprocessimagerefusal)

***

### discoverNativeUnwindFrames()

> **discoverNativeUnwindFrames**(`request`): [`NativeUnwindFrameDiscoveryResult`](#nativeunwindframediscoveryresult)

#### Parameters

##### request

[`NativeUnwindFrameDiscoveryRequest`](#nativeunwindframediscoveryrequest)

#### Returns

[`NativeUnwindFrameDiscoveryResult`](#nativeunwindframediscoveryresult)

***

### parseNativeEhFrameText()

> **parseNativeEhFrameText**(`request`): [`NativeEhFrameTextParseResult`](#nativeehframetextparseresult)

#### Parameters

##### request

[`NativeEhFrameTextParseRequest`](#nativeehframetextparserequest)

#### Returns

[`NativeEhFrameTextParseResult`](#nativeehframetextparseresult)

***

### nativeUnwindReturnAddressSlot()

> **nativeUnwindReturnAddressSlot**(`options`): `string`

#### Parameters

##### options

###### rule

[`NativeUnwindFrameRule`](#nativeunwindframerule)

###### sourceRegisters

[`NativeArm64Registers`](#nativearm64registers)

#### Returns

`string`

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

### planPortableMachineTargetRestoreDescriptor()

> **planPortableMachineTargetRestoreDescriptor**(`request`): [`PortableMachineTargetRestoreDescriptorPlan`](#portablemachinetargetrestoredescriptorplan)

#### Parameters

##### request

[`PortableMachineTargetRestoreDescriptorRequest`](#portablemachinetargetrestoredescriptorrequest)

#### Returns

[`PortableMachineTargetRestoreDescriptorPlan`](#portablemachinetargetrestoredescriptorplan)

***

### planPortableMachineVmRestoreProof()

> **planPortableMachineVmRestoreProof**(`request`): [`PortableMachineVmRestoreProofPlan`](#portablemachinevmrestoreproofplan)

#### Parameters

##### request

[`PortableMachineVmRestoreProofRequest`](#portablemachinevmrestoreproofrequest)

#### Returns

[`PortableMachineVmRestoreProofPlan`](#portablemachinevmrestoreproofplan)

***

### completePortableMachineVmRestoreProof()

> **completePortableMachineVmRestoreProof**(`plan`, `result`): [`PortableMachineVmRestoreProofPlan`](#portablemachinevmrestoreproofplan)

#### Parameters

##### plan

[`PortableMachineVmRestoreProofPlan`](#portablemachinevmrestoreproofplan)

##### result

[`PortableMachineVmRestoreTargetResult`](#portablemachinevmrestoretargetresult)

#### Returns

[`PortableMachineVmRestoreProofPlan`](#portablemachinevmrestoreproofplan)

***

### isPortableMachineSnapshotBundle()

> **isPortableMachineSnapshotBundle**(`rootDir`): `boolean`

#### Parameters

##### rootDir

`string`

#### Returns

`boolean`

***

### validatePortableMachineSnapshotBundle()

> **validatePortableMachineSnapshotBundle**(`rootDir`): [`PortableMachineSnapshotDocuments`](#portablemachinesnapshotdocuments)

#### Parameters

##### rootDir

`string`

#### Returns

[`PortableMachineSnapshotDocuments`](#portablemachinesnapshotdocuments)

***

### buildPortableMachineSnapshotManifestFromNativeProcessImage()

> **buildPortableMachineSnapshotManifestFromNativeProcessImage**(`nativeProcessImage`, `nativeProcessPath?`): [`PortableMachineSnapshotManifest`](#portablemachinesnapshotmanifest)

#### Parameters

##### nativeProcessImage

[`NativeProcessImageDocuments`](#nativeprocessimagedocuments)

##### nativeProcessPath?

`"native-process"` = `PORTABLE_MACHINE_SNAPSHOT_FILES.nativeProcessImage`

#### Returns

[`PortableMachineSnapshotManifest`](#portablemachinesnapshotmanifest)

***

### crossIsaVmstateRestoreRefusal()

> **crossIsaVmstateRestoreRefusal**(`sourceArch`, `targetArch`): [`PortableMachineSnapshotRefusal`](#portablemachinesnapshotrefusal)

#### Parameters

##### sourceArch

`string`

##### targetArch

`string`

#### Returns

[`PortableMachineSnapshotRefusal`](#portablemachinesnapshotrefusal)

***

### validatePortableMachineSnapshotManifest()

> **validatePortableMachineSnapshotManifest**(`input`): [`PortableMachineSnapshotManifest`](#portablemachinesnapshotmanifest)

#### Parameters

##### input

`unknown`

#### Returns

[`PortableMachineSnapshotManifest`](#portablemachinesnapshotmanifest)

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

### planTargetGuestMemoryMaterialization()

> **planTargetGuestMemoryMaterialization**(`request`): [`TargetGuestMemoryMaterializationResult`](#targetguestmemorymaterializationresult)

#### Parameters

##### request

[`TargetGuestMemoryMaterializationRequest`](#targetguestmemorymaterializationrequest)

#### Returns

[`TargetGuestMemoryMaterializationResult`](#targetguestmemorymaterializationresult)

***

### serializeTargetGuestRestoreDescriptor()

> **serializeTargetGuestRestoreDescriptor**(`descriptor`): `string`

#### Parameters

##### descriptor

[`TargetGuestRestoreDescriptor`](#targetguestrestoredescriptor)

#### Returns

`string`

***

### parseTargetGuestRestoreDescriptor()

> **parseTargetGuestRestoreDescriptor**(`text`): [`TargetGuestRestoreDescriptor`](#targetguestrestoredescriptor)

#### Parameters

##### text

`string`

#### Returns

[`TargetGuestRestoreDescriptor`](#targetguestrestoredescriptor)

***

### validateTargetGuestRestoreDescriptor()

> **validateTargetGuestRestoreDescriptor**(`descriptor`): [`TargetGuestRestoreDescriptor`](#targetguestrestoredescriptor)

#### Parameters

##### descriptor

[`TargetGuestRestoreDescriptor`](#targetguestrestoredescriptor)

#### Returns

[`TargetGuestRestoreDescriptor`](#targetguestrestoredescriptor)

***

### buildNativeActualResumeTrampolineArgs()

> **buildNativeActualResumeTrampolineArgs**(`descriptor`): `string`[]

#### Parameters

##### descriptor

[`TargetGuestRestoreDescriptor`](#targetguestrestoredescriptor)

#### Returns

`string`[]

***

### buildTargetGuestRestoreLoaderArgv()

> **buildTargetGuestRestoreLoaderArgv**(`descriptorPath`, `trampolinePath`): `string`[]

#### Parameters

##### descriptorPath

`string`

##### trampolinePath

`string`

#### Returns

`string`[]

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

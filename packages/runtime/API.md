# @machinen/runtime

## Classes

### MachinenError

Defined in: [errors.ts:135](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L135)

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

Defined in: [errors.ts:139](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L139)

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

Defined in: [errors.ts:136](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L136)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:137](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L137)

***

### BootError

Defined in: [errors.ts:148](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L148)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new BootError**(`code`, `message`, `opts?`): [`BootError`](#booterror)

Defined in: [errors.ts:139](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L139)

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

Defined in: [errors.ts:136](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L136)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:137](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L137)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### ExecError

Defined in: [errors.ts:149](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L149)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new ExecError**(`code`, `message`, `opts?`): [`ExecError`](#execerror)

Defined in: [errors.ts:139](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L139)

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

Defined in: [errors.ts:136](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L136)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:137](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L137)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### SnapshotError

Defined in: [errors.ts:150](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L150)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new SnapshotError**(`code`, `message`, `opts?`): [`SnapshotError`](#snapshoterror)

Defined in: [errors.ts:139](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L139)

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

Defined in: [errors.ts:136](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L136)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:137](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L137)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### ProvisionError

Defined in: [errors.ts:151](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L151)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new ProvisionError**(`code`, `message`, `opts?`): [`ProvisionError`](#provisionerror)

Defined in: [errors.ts:139](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L139)

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

Defined in: [errors.ts:136](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L136)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:137](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L137)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### RegistryError

Defined in: [errors.ts:152](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L152)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new RegistryError**(`code`, `message`, `opts?`): [`RegistryError`](#registryerror)

Defined in: [errors.ts:139](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L139)

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

Defined in: [errors.ts:136](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L136)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:137](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L137)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### FilesError

Defined in: [errors.ts:153](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L153)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new FilesError**(`code`, `message`, `opts?`): [`FilesError`](#fileserror)

Defined in: [errors.ts:139](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L139)

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

Defined in: [errors.ts:136](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L136)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:137](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L137)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### MountError

Defined in: [errors.ts:154](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L154)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new MountError**(`code`, `message`, `opts?`): [`MountError`](#mounterror)

Defined in: [errors.ts:139](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L139)

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

Defined in: [errors.ts:136](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L136)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:137](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L137)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### SecretsError

Defined in: [errors.ts:155](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L155)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new SecretsError**(`code`, `message`, `opts?`): [`SecretsError`](#secretserror)

Defined in: [errors.ts:139](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L139)

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

Defined in: [errors.ts:136](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L136)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:137](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L137)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### WinsizeError

Defined in: [errors.ts:156](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L156)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new WinsizeError**(`code`, `message`, `opts?`): [`WinsizeError`](#winsizeerror)

Defined in: [errors.ts:139](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L139)

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

Defined in: [errors.ts:136](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L136)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:137](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L137)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### SandboxError

Defined in: [errors.ts:157](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L157)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new SandboxError**(`code`, `message`, `opts?`): [`SandboxError`](#sandboxerror)

Defined in: [errors.ts:139](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L139)

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

Defined in: [errors.ts:136](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L136)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:137](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L137)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### CacheError

Defined in: [errors.ts:158](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L158)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new CacheError**(`code`, `message`, `opts?`): [`CacheError`](#cacheerror)

Defined in: [errors.ts:139](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L139)

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

Defined in: [errors.ts:136](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L136)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:137](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L137)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### GvproxyError

Defined in: [errors.ts:159](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L159)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new GvproxyError**(`code`, `message`, `opts?`): [`GvproxyError`](#gvproxyerror)

Defined in: [errors.ts:139](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L139)

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

Defined in: [errors.ts:136](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L136)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:137](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L137)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### MkinitramfsError

Defined in: [errors.ts:160](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L160)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new MkinitramfsError**(`code`, `message`, `opts?`): [`MkinitramfsError`](#mkinitramfserror)

Defined in: [errors.ts:139](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L139)

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

Defined in: [errors.ts:136](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L136)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:137](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L137)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### ParseError

Defined in: [errors.ts:161](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L161)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new ParseError**(`code`, `message`, `opts?`): [`ParseError`](#parseerror)

Defined in: [errors.ts:139](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L139)

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

Defined in: [errors.ts:136](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L136)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:137](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L137)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### Sandboxes

Defined in: [multiplex.ts:39](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L39)

Registry of live sandboxes. Thread-safe in the sense that there's
only one runtime thread anyway; the class just bookkeeps handles +
their scrollback rings so the supervisor doesn't need to.

#### Constructors

##### Constructor

> **new Sandboxes**(`opts?`): [`Sandboxes`](#sandboxes)

Defined in: [multiplex.ts:51](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L51)

###### Parameters

###### opts?

###### scrollbackBytes?

`number`

###### Returns

[`Sandboxes`](#sandboxes)

#### Properties

##### scrollbackBytes

> `readonly` **scrollbackBytes**: `number`

Defined in: [multiplex.ts:49](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L49)

Maximum bytes retained per sandbox for replay on attach. The ring
keeps only the most recent chunk up to this limit — a reasonable
trade between "see enough context to know what's going on" and
"don't leak memory if the sandbox runs for hours."

#### Methods

##### add()

> **add**(`id`, `vm`): `void`

Defined in: [multiplex.ts:57](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L57)

###### Parameters

###### id

`string`

###### vm

[`VmHandle`](#vmhandle)

###### Returns

`void`

##### remove()

> **remove**(`id`): `void`

Defined in: [multiplex.ts:81](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L81)

Remove a sandbox. Does not kill the VM — call `vm.kill()` first.

###### Parameters

###### id

`string`

###### Returns

`void`

##### list()

> **list**(): `object`[]

Defined in: [multiplex.ts:86](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L86)

###### Returns

`object`[]

##### get()

> **get**(`id`): [`SandboxEntry`](#sandboxentry)

Defined in: [multiplex.ts:93](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L93)

###### Parameters

###### id

`string`

###### Returns

[`SandboxEntry`](#sandboxentry)

##### send()

> **send**(`id`, `data`): `boolean`

Defined in: [multiplex.ts:98](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L98)

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

Defined in: [multiplex.ts:112](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L112)

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

Defined in: [multiplex.ts:178](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L178)

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

Defined in: [multiplex.ts:194](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L194)

###### Parameters

###### opts

[`SupervisorOptions`](#supervisoroptions)

###### Returns

[`Supervisor`](#supervisor)

#### Properties

##### sandboxes

> `readonly` **sandboxes**: [`Sandboxes`](#sandboxes)

Defined in: [multiplex.ts:179](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L179)

#### Methods

##### run()

> **run**(): `Promise`\<`void`\>

Defined in: [multiplex.ts:210](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L210)

Run until stopped. Resolves when input ends or stop() is called.

###### Returns

`Promise`\<`void`\>

##### stop()

> **stop**(): `void`

Defined in: [multiplex.ts:227](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L227)

Programmatic stop (e.g. from a test).

###### Returns

`void`

##### attach()

> **attach**(`id`): `void`

Defined in: [multiplex.ts:237](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L237)

Attach to `id`. Throws if id doesn't exist.

###### Parameters

###### id

`string`

###### Returns

`void`

##### detach()

> **detach**(): `void`

Defined in: [multiplex.ts:266](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L266)

###### Returns

`void`

***

### VsockWinsize

Defined in: [winsize.ts:37](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/winsize.ts#L37)

#### Methods

##### connect()

> `static` **connect**(`udsPath`, `opts?`): `Promise`\<[`VsockWinsize`](#vsockwinsize)\>

Defined in: [winsize.ts:59](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/winsize.ts#L59)

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

Defined in: [winsize.ts:86](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/winsize.ts#L86)

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

Defined in: [winsize.ts:98](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/winsize.ts#L98)

###### Returns

`void`

## Interfaces

### MachinenErrorOptions

Defined in: [errors.ts:118](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L118)

#### Properties

##### retryable?

> `optional` **retryable?**: `boolean`

Defined in: [errors.ts:125](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L125)

True if retrying the same call could plausibly succeed (transient
network blip, upstream fetch, vsock agent not listening yet). False
for misconfiguration (missing binary, bad mount path, invalid
port).

##### cause?

> `optional` **cause?**: `unknown`

Defined in: [errors.ts:127](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L127)

Underlying error preserved via the standard `Error.cause` chain.

***

### VsockExecOptions

Defined in: [exec.ts:38](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L38)

#### Properties

##### connectTimeoutMs?

> `optional` **connectTimeoutMs?**: `number`

Defined in: [exec.ts:40](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L40)

How long to keep retrying the UDS connect. Default 30s.

##### retryMs?

> `optional` **retryMs?**: `number`

Defined in: [exec.ts:42](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L42)

Poll interval in ms while retrying. Default 250.

##### execTimeoutMs?

> `optional` **execTimeoutMs?**: `number`

Defined in: [exec.ts:49](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L49)

Wall-clock ceiling for the spawned command. Default 5 minutes.
Pass `null` (or `Infinity`) to disable — appropriate for
long-running siblings (dev servers, file watchers, log tailers)
that should live for the VM's lifetime. Mirrors `boot({ timeoutMs: null })`.

##### onStdout?

> `optional` **onStdout?**: (`chunk`) => `void`

Defined in: [exec.ts:51](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L51)

Called with each stdout chunk as it arrives (pass-through tee).

###### Parameters

###### chunk

`Buffer`

###### Returns

`void`

##### onStderr?

> `optional` **onStderr?**: (`chunk`) => `void`

Defined in: [exec.ts:53](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L53)

Called with each stderr chunk as it arrives (pass-through tee).

###### Parameters

###### chunk

`Buffer`

###### Returns

`void`

***

### VsockExecResult

Defined in: [exec.ts:56](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L56)

#### Properties

##### exitCode

> **exitCode**: `number`

Defined in: [exec.ts:57](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L57)

##### stdout

> **stdout**: `string`

Defined in: [exec.ts:58](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L58)

##### stderr

> **stderr**: `string`

Defined in: [exec.ts:59](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L59)

***

### VsockExecPtyOptions

Defined in: [exec.ts:160](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L160)

#### Properties

##### cols

> **cols**: `number`

Defined in: [exec.ts:162](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L162)

Initial window size; the guest passes this to forkpty()'s winp.

##### rows

> **rows**: `number`

Defined in: [exec.ts:163](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L163)

##### stdin

> **stdin**: `Readable`

Defined in: [exec.ts:169](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L169)

Host-side input source. Each `data` chunk is forwarded as an
`I <n>\n<bytes>` frame. Caller wires `process.stdin` (in raw
mode) here for an interactive shell.

##### stdout

> **stdout**: `Writable`

Defined in: [exec.ts:174](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L174)

Host-side sink for PTY master output (`O <n>\n<bytes>` frames).
Caller wires `process.stdout`.

##### connectTimeoutMs?

> `optional` **connectTimeoutMs?**: `number`

Defined in: [exec.ts:176](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L176)

Connect timeout (ms). Default 5000 — agent should already be up.

***

### VsockExecPtyResult

Defined in: [exec.ts:179](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L179)

#### Properties

##### exitCode

> **exitCode**: `number`

Defined in: [exec.ts:180](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L180)

***

### VsockExecPtyHandle

Defined in: [exec.ts:183](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L183)

#### Properties

##### result

> `readonly` **result**: `Promise`\<[`VsockExecPtyResult`](#vsockexecptyresult)\>

Defined in: [exec.ts:185](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L185)

Resolves with the workload's exit code once X arrives.

#### Methods

##### resize()

> **resize**(`cols`, `rows`): `void`

Defined in: [exec.ts:187](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L187)

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

Defined in: [exec.ts:189](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L189)

Disconnect; agent will SIGHUP the workload.

###### Returns

`void`

***

### VsockFilesOptions

Defined in: [files.ts:26](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/files.ts#L26)

#### Properties

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [files.ts:28](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/files.ts#L28)

How long to retry the UDS connect. Default 5s.

##### retryMs?

> `optional` **retryMs?**: `number`

Defined in: [files.ts:29](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/files.ts#L29)

##### excludes?

> `optional` **excludes?**: `string`[]

Defined in: [files.ts:31](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/files.ts#L31)

Forwarded to `tar --exclude=PATTERN`. Repeat per pattern.

***

### GcResult

Defined in: [gc.ts:22](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/gc.ts#L22)

Per-entry record of what `runGc` did (or would do, with dryRun).

#### Properties

##### pid

> **pid**: `number`

Defined in: [gc.ts:23](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/gc.ts#L23)

##### name?

> `optional` **name?**: `string`

Defined in: [gc.ts:24](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/gc.ts#L24)

##### status

> **status**: [`PidStatus`](#pidstatus)

Defined in: [gc.ts:25](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/gc.ts#L25)

##### removedPaths

> **removedPaths**: `string`[]

Defined in: [gc.ts:27](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/gc.ts#L27)

Paths removed (or that would be removed under `dryRun`).

##### failedPaths

> **failedPaths**: `string`[]

Defined in: [gc.ts:29](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/gc.ts#L29)

Paths the gc tried to rm but couldn't (already gone, EPERM, …).

##### registryRemoved

> **registryRemoved**: `boolean`

Defined in: [gc.ts:31](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/gc.ts#L31)

True if the registry entry was (or would be) dropped.

***

### RunGcOptions

Defined in: [gc.ts:34](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/gc.ts#L34)

#### Properties

##### dryRun?

> `optional` **dryRun?**: `boolean`

Defined in: [gc.ts:39](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/gc.ts#L39)

When true, list what would be cleaned without touching the disk
or registry. Used by `machinen gc --dry-run` and tests.

##### pid?

> `optional` **pid?**: `number`

Defined in: [gc.ts:44](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/gc.ts#L44)

Only act on this single entry (skip everything else in the
registry). Used by `machinen stop` after killing a specific VM.

***

### ChunkLogEvent

Defined in: [log.ts:19](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/log.ts#L19)

#### Properties

##### source

> **source**: `"guest-console"` \| `"exec-stdout"` \| `"exec-stderr"`

Defined in: [log.ts:26](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/log.ts#L26)

Where the chunk came from:
  - `guest-console` — kernel / PL011 console bytes (VMM stderr)
  - `exec-stdout`   — stdout of an exec invocation
  - `exec-stderr`   — stderr of an exec invocation

##### cmd?

> `optional` **cmd?**: `string`

Defined in: [log.ts:28](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/log.ts#L28)

Command string; set when `source` is `exec-stdout` or `exec-stderr`.

##### chunk

> **chunk**: `Buffer`

Defined in: [log.ts:30](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/log.ts#L30)

Raw bytes as they arrive — not line-split, not decoded.

***

### PhaseLogEvent

Defined in: [log.ts:33](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/log.ts#L33)

#### Properties

##### source

> **source**: `"phase"`

Defined in: [log.ts:34](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/log.ts#L34)

##### kind

> **kind**: `"boot"` \| `"provision"` \| `"snapshot"` \| `"restore"`

Defined in: [log.ts:36](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/log.ts#L36)

Which runtime entry point produced these phases.

##### phases

> **phases**: `ReadonlyMap`\<`string`, `number`\>

Defined in: [log.ts:38](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/log.ts#L38)

Phase name → wall-clock ms. Insertion order = timeline order.

##### totalMs

> **totalMs**: `number`

Defined in: [log.ts:40](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/log.ts#L40)

Wall-clock between PhaseTimer construction and flush.

***

### PackBundleOptions

Defined in: [mkinitramfs.ts:326](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L326)

#### Properties

##### bundle

> **bundle**: `string`

Defined in: [mkinitramfs.ts:328](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L328)

Bundle directory with rootfs/ + machinen-config.json.

##### out

> **out**: `string`

Defined in: [mkinitramfs.ts:330](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L330)

Path to the initramfs cpio to write.

##### base?

> `optional` **base?**: `string`

Defined in: [mkinitramfs.ts:332](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L332)

Optional base rootfs tarball (rootfs-debian-arm64.tar.gz).

##### mount?

> `optional` **mount?**: `object`

Defined in: [mkinitramfs.ts:339](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L339)

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

Defined in: [mkinitramfs.ts:346](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L346)

Extra env vars to merge into the bundle's machinen-config.json `env`
field before packing. The bundle's on-disk env wins on key collision
(same precedence as the mount overlay — bundle always gets the last
word). See #89.

##### excludes?

> `optional` **excludes?**: `string`[]

Defined in: [mkinitramfs.ts:348](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L348)

fnmatch patterns matched against each rootfs-relative path.

##### initPath?

> `optional` **initPath?**: `string`

Defined in: [mkinitramfs.ts:350](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L350)

Optional path to the compiled /init. Default: ../microvm/test-fixtures/init relative to this file.

##### fuseAgentPath?

> `optional` **fuseAgentPath?**: `string`

Defined in: [mkinitramfs.ts:356](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L356)

Optional host path to the compiled fuse-agent binary. When set,
the binary is injected at `/fuse-agent` (mode 0755) inside the
initramfs so /init can fork it per live-share mount. See #78.

##### execAgentPath?

> `optional` **execAgentPath?**: `string`

Defined in: [mkinitramfs.ts:362](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L362)

Optional path to the compiled /exec-agent. Default: same dir as
/init under packages/microvm/test-fixtures/. Used to override the
stale /exec-agent that may live in a re-provisioned base tarball.

***

### PackTinyBundleOptions

Defined in: [mkinitramfs.ts:497](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L497)

#### Properties

##### bundle

> **bundle**: `string`

Defined in: [mkinitramfs.ts:499](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L499)

Bundle directory with machinen-config.json. The bundle's rootfs/ is ignored — the on-disk rootfs is on /dev/vda.

##### out

> **out**: `string`

Defined in: [mkinitramfs.ts:501](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L501)

Path to the initramfs cpio to write.

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Defined in: [mkinitramfs.ts:503](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L503)

Extra env merged into the bundle's machinen-config.json. Bundle keys win on collision.

##### mount?

> `optional` **mount?**: `object`

Defined in: [mkinitramfs.ts:509](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L509)

Optional host directory copied into the cpio at `/<guest>/`. Same
semantics as packBundle.mount — guest must live under /mnt/.
/init carries it across the rootdisk pivot.

###### host

> **host**: `string`

###### guest

> **guest**: `string`

##### initPath?

> `optional` **initPath?**: `string`

Defined in: [mkinitramfs.ts:511](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L511)

Optional override for the compiled /init. Default: ../microvm/test-fixtures/init relative to this file.

##### fuseAgentPath?

> `optional` **fuseAgentPath?**: `string`

Defined in: [mkinitramfs.ts:513](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L513)

Optional path to the compiled fuse-agent; staged at /fuse-agent when set.

***

### PackRootfsOptions

Defined in: [mkinitramfs.ts:618](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L618)

#### Properties

##### rootfs

> **rootfs**: `string`

Defined in: [mkinitramfs.ts:619](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L619)

##### out

> **out**: `string`

Defined in: [mkinitramfs.ts:620](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L620)

##### config?

> `optional` **config?**: `string`

Defined in: [mkinitramfs.ts:621](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L621)

##### excludes?

> `optional` **excludes?**: `string`[]

Defined in: [mkinitramfs.ts:622](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L622)

##### initPath?

> `optional` **initPath?**: `string`

Defined in: [mkinitramfs.ts:623](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L623)

***

### PackMinimalOptions

Defined in: [mkinitramfs.ts:640](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L640)

#### Properties

##### out

> **out**: `string`

Defined in: [mkinitramfs.ts:641](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L641)

##### initPath?

> `optional` **initPath?**: `string`

Defined in: [mkinitramfs.ts:642](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L642)

##### config?

> `optional` **config?**: `string`

Defined in: [mkinitramfs.ts:643](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L643)

***

### PackWorkspaceOptions

Defined in: [mkinitramfs.ts:661](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L661)

#### Properties

##### workspace

> **workspace**: `string`

Defined in: [mkinitramfs.ts:662](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L662)

##### out

> **out**: `string`

Defined in: [mkinitramfs.ts:663](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L663)

##### mountpoint?

> `optional` **mountpoint?**: `string`

Defined in: [mkinitramfs.ts:665](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L665)

Directory name inside the cpio (default `workspace`).

##### excludes?

> `optional` **excludes?**: `Iterable`\<`string`\>

Defined in: [mkinitramfs.ts:667](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L667)

Basename-matched excludes. Default: DEFAULT_WORKSPACE_EXCLUDES.

##### maxMb?

> `optional` **maxMb?**: `number`

Defined in: [mkinitramfs.ts:669](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L669)

Max final size in MiB (default 500). Throws if exceeded.

***

### SandboxEntry

Defined in: [multiplex.ts:23](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L23)

#### Properties

##### id

> **id**: `string`

Defined in: [multiplex.ts:24](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L24)

##### vm

> **vm**: [`VmHandle`](#vmhandle)

Defined in: [multiplex.ts:25](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L25)

##### scrollback

> **scrollback**: `Buffer`

Defined in: [multiplex.ts:26](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L26)

##### addedAt

> `readonly` **addedAt**: `number`

Defined in: [multiplex.ts:27](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L27)

***

### OnOutputListener()

Defined in: [multiplex.ts:30](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L30)

> **OnOutputListener**(`chunk`, `source`): `void`

Defined in: [multiplex.ts:31](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L31)

#### Parameters

##### chunk

`Buffer`

##### source

`"stdout"` \| `"stderr"`

#### Returns

`void`

***

### SupervisorOptions

Defined in: [multiplex.ts:142](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L142)

#### Properties

##### sandboxes

> **sandboxes**: [`Sandboxes`](#sandboxes)

Defined in: [multiplex.ts:144](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L144)

Registry to draw sandboxes from.

##### input?

> `optional` **input?**: `ReadableStream`

Defined in: [multiplex.ts:146](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L146)

Input byte stream. Defaults to `process.stdin`.

##### output?

> `optional` **output?**: `Writable`

Defined in: [multiplex.ts:148](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L148)

Output byte stream. Defaults to `process.stdout`.

##### commandPrefix?

> `optional` **commandPrefix?**: `string`

Defined in: [multiplex.ts:150](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L150)

Prefix for slash-commands. Default `/`.

##### rawTtyOnAttach?

> `optional` **rawTtyOnAttach?**: `boolean`

Defined in: [multiplex.ts:156](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L156)

Flip the terminal into raw mode while a sandbox is attached, and
restore it on detach. Enabled by default when `input` is a TTY.
Set to `false` in tests where `input` is a plain PassThrough.

##### forwardResize?

> `optional` **forwardResize?**: `boolean`

Defined in: [multiplex.ts:162](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L162)

Forward SIGWINCH on the parent process (terminal resize) to any
attached sandbox that implements `.resize(cols, rows)`. Enabled
by default when `output` is a TTY.

***

### ProvisionOptions

Defined in: [provision.ts:52](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L52)

#### Properties

##### base?

> `optional` **base?**: `string`

Defined in: [provision.ts:62](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L62)

Path to the base rootfs tarball to start from. Typically the
`rootfs-debian-arm64.tar.gz` produced by
`scripts/build-base-assets.sh` or shipped in a machinen release.

Optional — when omitted, `provision()` resolves it via `resolveBaseRootfs()`
(MACHINEN_ASSETS_DIR env override, falling back to the `@machinen/cli`
cache at `~/.machinen/@machinen/runtime@<version>/bases/debian-arm64/`).

##### install

> **install**: (`vm`) => `Promise`\<`void`\>

Defined in: [provision.ts:67](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L67)

User-supplied provisioning steps. Runs inside the guest via vsock.

###### Parameters

###### vm

[`VmHandle`](#vmhandle)

###### Returns

`Promise`\<`void`\>

##### out

> **out**: `string`

Defined in: [provision.ts:73](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L73)

Output path for the resulting rootfs tarball. Will be overwritten.
Consumed via `boot({ image: out })`.

##### cmd?

> `optional` **cmd?**: `string`[]

Defined in: [provision.ts:81](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L81)

Default cmd baked into the image as `/machinen-config.json`.
When the image is later booted via `boot({ image })` without a
user-supplied `cmd`, the guest runs this. User-supplied `cmd` on
`boot()` still wins if provided.

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Defined in: [provision.ts:88](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L88)

Default guest env baked into the image alongside `cmd`. Merged
with `boot({ env })` at boot time, with the caller's `env`
overriding on key collision.

##### binary?

> `optional` **binary?**: `string`

Defined in: [provision.ts:94](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L94)

Optional VMM binary path. Same lookup rules as `boot()` — if
omitted, resolves `@machinen/vmm-<arch>-<os>`.

##### cwd?

> `optional` **cwd?**: `string`

Defined in: [provision.ts:97](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L97)

Working directory. Defaults to process.cwd().

##### scratchDiskSizeBytes?

> `optional` **scratchDiskSizeBytes?**: `number`

Defined in: [provision.ts:104](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L104)

Size of the scratch disk used to ferry the tarball from guest to
host. Must be larger than the expected post-install rootfs size.
Default: 1 GiB (sparse, so it doesn't actually take that space).

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [provision.ts:111](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L111)

Wall-clock ceiling for the whole build. If the install hook plus
the final archive + shutdown doesn't finish in this window, we
SIGKILL the VMM and fail. Default: 10 minutes.

##### vmmEnv?

> `optional` **vmmEnv?**: `Record`\<`string`, `string`\>

Defined in: [provision.ts:118](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L118)

Extra env passed to the VMM process on the host side. Useful for
dev overrides like `MACHINEN_BOOT_TEST`. Distinct from `env`,
which bakes guest-workload env into the produced image.

##### kernel?

> `optional` **kernel?**: `string`

Defined in: [provision.ts:121](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L121)

Path to the guest kernel. Same semantics as `boot({ kernel })`.

##### dtb?

> `optional` **dtb?**: `string`

Defined in: [provision.ts:124](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L124)

Path to the guest DTB. Same semantics as `boot({ dtb })`.

##### onLog?

> `optional` **onLog?**: [`OnLog`](#onlog)

Defined in: [provision.ts:132](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L132)

Streaming log callback — fires for every byte of guest output
during the build: guest kernel console, every `vm.exec()` call
the install hook makes, and the internal tar / poweroff execs.
See `LogEvent.source` to tell them apart. See #83.

***

### ProvisionResult

Defined in: [provision.ts:135](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L135)

#### Properties

##### imagePath

> **imagePath**: `string`

Defined in: [provision.ts:137](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L137)

Absolute path to the output tarball.

##### sizeBytes

> **sizeBytes**: `number`

Defined in: [provision.ts:140](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L140)

Size of the output tarball in bytes.

##### elapsedMs

> **elapsedMs**: `number`

Defined in: [provision.ts:143](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L143)

Wall-clock time from build() entry to return.

***

### PtyBootOptions

Defined in: [pty.ts:91](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L91)

#### Properties

##### binary

> **binary**: `string`

Defined in: [pty.ts:93](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L93)

Absolute or cwd-relative path to the binary to fork.

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Defined in: [pty.ts:95](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L95)

Extra env. Merged over process.env.

##### cwd?

> `optional` **cwd?**: `string`

Defined in: [pty.ts:96](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L96)

##### args?

> `optional` **args?**: `string`[]

Defined in: [pty.ts:97](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L97)

##### cols?

> `optional` **cols?**: `number`

Defined in: [pty.ts:99](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L99)

Initial terminal size. Defaults to 80x24.

##### rows?

> `optional` **rows?**: `number`

Defined in: [pty.ts:100](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L100)

##### name?

> `optional` **name?**: `string`

Defined in: [pty.ts:102](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L102)

TERM value. Default `xterm-256color` — the CC banner wants colors.

***

### PtyVmHandle

Defined in: [pty.ts:105](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L105)

#### Properties

##### pid

> `readonly` **pid**: `number`

Defined in: [pty.ts:106](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L106)

##### stdin

> `readonly` **stdin**: `Writable`

Defined in: [pty.ts:107](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L107)

##### stdout

> `readonly` **stdout**: `Readable`

Defined in: [pty.ts:108](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L108)

##### stderr

> `readonly` **stderr**: `Readable`

Defined in: [pty.ts:110](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L110)

Same stream as `stdout`. A pty merges stdout + stderr in the kernel.

#### Methods

##### resize()

> **resize**(`cols`, `rows`): `void`

Defined in: [pty.ts:112](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L112)

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

Defined in: [pty.ts:113](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L113)

###### Returns

`Promise`\<\{ `code`: `number`; `signal`: `Signals`; \}\>

##### kill()

> **kill**(): `Promise`\<`void`\>

Defined in: [pty.ts:114](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L114)

###### Returns

`Promise`\<`void`\>

##### output()

> **output**(): `Promise`\<`string`\>

Defined in: [pty.ts:115](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L115)

###### Returns

`Promise`\<`string`\>

##### errorOutput()

> **errorOutput**(): `Promise`\<`string`\>

Defined in: [pty.ts:117](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L117)

Alias of output() — a pty gives us one merged stream.

###### Returns

`Promise`\<`string`\>

***

### RegistryEntry

Defined in: [registry.ts:41](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L41)

#### Properties

##### pid

> **pid**: `number`

Defined in: [registry.ts:43](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L43)

PID of the VMM process on this host — primary key.

##### name?

> `optional` **name?**: `string`

Defined in: [registry.ts:45](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L45)

Optional human-friendly name (from `boot({ name })`). Path-shaped allowed.

##### socketPath

> **socketPath**: `string`

Defined in: [registry.ts:47](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L47)

Host-side vsock UDS the exec-agent is reachable on.

##### imagePath?

> `optional` **imagePath?**: `string`

Defined in: [registry.ts:49](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L49)

Path to the image the VM was booted from (diagnostic only).

##### diskPath?

> `optional` **diskPath?**: `string`

Defined in: [registry.ts:56](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L56)

Host-side path of the disk file attached as /dev/vda (from
`boot({ snapshot: <path> })`). Required for `vm.snapshot()` —
attached handles read it from the registry to find the host
file to copy after the guest dump completes.

##### forkedFrom?

> `optional` **forkedFrom?**: `string`

Defined in: [registry.ts:61](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L61)

Absolute path to the snapshot directory this VM was forked from
(set by `restore({ snapDir })`). Visible in `ls`; informational.

##### bootLogPath?

> `optional` **bootLogPath?**: `string`

Defined in: [registry.ts:69](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L69)

Path to the one-shot boot-console snapshot written at detach time
(issue #150 phase 2). Only set on entries booted with
`--detached`; live post-detach console bytes are dropped on the
floor (the VMM ignores SIGPIPE), so this file is the only record
of the boot sequence on a detached VM.

##### cleanupPaths?

> `optional` **cleanupPaths?**: `string`[]

Defined in: [registry.ts:78](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L78)

Per-boot artifacts that need to be removed when the VMM exits.
Today the in-process exit hook handles this for non-detached
boots. After detach (#150 phase 2) the parent is gone before the
VMM exits — `machinen gc` / `machinen stop` use this list to
clean up afterward. Each entry is an absolute path to either a
file (per-boot disk image) or a directory (bundle / vsock UDS).

##### vmmExe?

> `optional` **vmmExe?**: `string`

Defined in: [registry.ts:86](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L86)

Absolute path to the VMM binary that was spawned. `machinen gc`
compares this against `/proc/<pid>/exe` (Linux) or `ps -o comm=`
(macOS) before treating an entry as live — without it, a recycled
pid that happens to belong to some other process would look alive
to `kill(pid, 0)` and the entry would be kept around forever.

##### gvproxyPid?

> `optional` **gvproxyPid?**: `number`

Defined in: [registry.ts:95](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L95)

PID of the gvproxy process spawned alongside this VMM (issue #150
phase 2 PR3). Recorded so `machinen stop` can SIGTERM gvproxy at
the same time as the VMM, and so `machinen gc` can validate /
reap it independently. Undefined when the VM was booted without
networking (no gvproxy binary, or `MACHINEN_NET_SOCKET` was
pre-set by the caller).

##### gvproxyExe?

> `optional` **gvproxyExe?**: `string`

Defined in: [registry.ts:102](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L102)

Absolute path to the gvproxy binary spawned for this VM. Used by
`machinen stop` for the same anti-recycling check the VMM gets
via `vmmExe` — we don't want to SIGTERM whatever process inherits
gvproxy's pid weeks later.

##### portForward?

> `optional` **portForward?**: `object`[]

Defined in: [registry.ts:109](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L109)

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

##### startedAt

> **startedAt**: `number`

Defined in: [registry.ts:111](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L111)

ms epoch when the entry was created.

***

### EnsureRootfsImageOptions

Defined in: [rootfs-img.ts:135](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/rootfs-img.ts#L135)

#### Properties

##### cacheDir?

> `optional` **cacheDir?**: `string`

Defined in: [rootfs-img.ts:140](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/rootfs-img.ts#L140)

Override the cache directory. Default: `~/.cache/machinen/rootfs`.
Useful for tests.

##### force?

> `optional` **force?**: `boolean`

Defined in: [rootfs-img.ts:145](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/rootfs-img.ts#L145)

Force re-materialization even if a cached image is already present.
Mostly for debugging the materializer.

##### sizeMultiplier?

> `optional` **sizeMultiplier?**: `number`

Defined in: [rootfs-img.ts:155](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/rootfs-img.ts#L155)

Slack multiplier above the unpacked tarball size when sizing the
ext4 filesystem. Default: 2.5 — leaves enough room for the guest
to install a few hundred MB of packages on top of the base rootfs
before hitting ENOSPC. Sparse files cost nothing on disk until
written, so over-provisioning is essentially free; the trade-off
is a higher upper bound on physical disk use if the guest decides
to fill the filesystem.

##### minSizeBytes?

> `optional` **minSizeBytes?**: `number`

Defined in: [rootfs-img.ts:163](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/rootfs-img.ts#L163)

Minimum image size in bytes. The materializer enforces at least
this for small rootfs where the multiplier alone would leave
insufficient room for a real workload. Default: 2 GiB — boot-time
`npm install -g <large package>`, `apt install`, etc. land here
(#131). Sparse, so unused capacity is free.

##### sizeBytes?

> `optional` **sizeBytes?**: `number`

Defined in: [rootfs-img.ts:171](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/rootfs-img.ts#L171)

Absolute target size in bytes. When set, overrides `sizeMultiplier`
and `minSizeBytes` entirely — fresh materializations get exactly
this size, cached `.img`s smaller than this are sparse-extended
(truncate(2)) so the next boot's online ext4 grow can fill them.
For the user-facing `boot({ rootDiskSizeBytes })` knob (#131).

##### onPhase?

> `optional` **onPhase?**: (`name`, `ms`) => `void`

Defined in: [rootfs-img.ts:179](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/rootfs-img.ts#L179)

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

Defined in: [secrets.ts:26](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/secrets.ts#L26)

#### Properties

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [secrets.ts:28](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/secrets.ts#L28)

How long to keep retrying the UDS connect. Default 10s.

##### retryMs?

> `optional` **retryMs?**: `number`

Defined in: [secrets.ts:30](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/secrets.ts#L30)

Poll interval in ms while retrying. Default 250.

***

### VmHandle

Defined in: [vm-handle.ts:15](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L15)

#### Properties

##### pid

> `readonly` **pid**: `number`

Defined in: [vm-handle.ts:22](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L22)

PID of the host-side VMM process — primary identifier across
boot/attach. Kernel-unique while alive; reused after exit, so
pass it to `attach({ pid })` while the VM is live (or use
`--name` for a stable handle).

##### name?

> `readonly` `optional` **name?**: `string`

Defined in: [vm-handle.ts:24](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L24)

Optional human-friendly name passed to `boot({ name })`.

##### stdin

> `readonly` **stdin**: `Writable`

Defined in: [vm-handle.ts:25](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L25)

##### stdout

> `readonly` **stdout**: `Readable`

Defined in: [vm-handle.ts:26](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L26)

##### stderr

> `readonly` **stderr**: `Readable`

Defined in: [vm-handle.ts:27](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L27)

#### Methods

##### wait()

> **wait**(): `Promise`\<\{ `code`: `number`; `signal`: `Signals`; \}\>

Defined in: [vm-handle.ts:30](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L30)

Resolves when the VM process exits. Rejects on timeout.

###### Returns

`Promise`\<\{ `code`: `number`; `signal`: `Signals`; \}\>

##### kill()

> **kill**(): `Promise`\<`void`\>

Defined in: [vm-handle.ts:33](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L33)

Send SIGKILL to the VM. Resolves once it's really gone.

###### Returns

`Promise`\<`void`\>

##### detach()

> **detach**(): `Promise`\<`void`\>

Defined in: [vm-handle.ts:41](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L41)

Drop this host-side handle without killing the VMM. The VM keeps
running and can be re-attached from another process. For locally-
booted handles this closes captured streams; `wait()` and
`exec()` become unreliable afterwards.

###### Returns

`Promise`\<`void`\>

##### output()

> **output**(): `Promise`\<`string`\>

Defined in: [vm-handle.ts:49](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L49)

Buffer stdout until the process exits; return it as a UTF-8 string.
Capped at ~1 MiB tail — long-running VMs keep only the most recent
bytes (issue #150). Sufficient for kernel boot console + test
assertions; not a full transcript.

###### Returns

`Promise`\<`string`\>

##### errorOutput()

> **errorOutput**(): `Promise`\<`string`\>

Defined in: [vm-handle.ts:52](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L52)

Same as `output()` but for stderr (where guest console lands).

###### Returns

`Promise`\<`string`\>

##### exec()

> **exec**(`cmd`, `opts?`): `Promise`\<[`VsockExecResult`](#vsockexecresult)\>

Defined in: [vm-handle.ts:63](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L63)

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

Defined in: [vm-handle.ts:66](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L66)

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

Defined in: [vm-handle.ts:79](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L79)

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

Defined in: [vm-handle.ts:100](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L100)

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

Defined in: [vm-handle.ts:131](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L131)

Freeze this VM with CRIU and write a snapshot bundle into
`opts.outDir`. The bundle is a directory containing:

  <outDir>/disk.img      ← CRIU image set on an ext4 volume
  <outDir>/meta.json     ← source name + timestamp

The caller must have booted the VM with `snapshot: '<scratch>'`
so the guest had a /dev/vda to dump into; otherwise this throws
`SNAPSHOT_NO_DISK`.

Guest contract: the rootfs ships a dump helper callable via
vsock exec — default `/sbin/machinen-dump`, override via
`opts.dumpCmd`. The helper runs `criu dump` against the
workload tree, syncs the ext4 images, and lets
`/sbin/machinen-supervisor` trigger PSCI SYSTEM_OFF. Success is
signalled by a clean VMM exit before `opts.timeoutMs` elapses
plus an mtime bump on the disk file — timer expiration throws
`SNAPSHOT_TIMEOUT`; an untouched disk throws
`SNAPSHOT_DUMP_FAILED`.

Supported on both boot-owned and attach handles — attach uses
the `diskPath` stored in the VM registry entry at boot time.

By default the VM exits as part of the dump (CRIU kills the
dumped tree on success). Pass `opts.leaveRunning: true` to keep
the source VM alive — the workload resumes from the dump point
and the bundle can be restored into a sibling VM (`vm.fork()`).

###### Parameters

###### opts

[`SnapshotOptions`](#snapshotoptions)

###### Returns

`Promise`\<[`SnapshotResult`](#snapshotresult)\>

##### fork()

> **fork**(`opts?`): `Promise`\<[`VmHandle`](#vmhandle)\>

Defined in: [vm-handle.ts:154](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L154)

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

### WriteFileOptions

Defined in: [vm-handle.ts:157](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L157)

#### Properties

##### mode?

> `optional` **mode?**: `number`

Defined in: [vm-handle.ts:159](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L159)

Octal mode for the destination file (e.g. `0o755`). Default: leave as-is.

##### recursive?

> `optional` **recursive?**: `boolean`

Defined in: [vm-handle.ts:161](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L161)

`mkdir -p` the parent directory before writing. Default: true.

##### append?

> `optional` **append?**: `boolean`

Defined in: [vm-handle.ts:163](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L163)

Append to the file instead of overwriting. Default: false.

***

### SnapshotOptions

Defined in: [vm-handle.ts:166](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L166)

#### Properties

##### outDir

> **outDir**: `string`

Defined in: [vm-handle.ts:172](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L172)

Directory the snapshot bundle is written to. Created if missing
and required to be empty (or absent) so a previous snapshot
can't be silently overwritten.

##### dumpCmd?

> `optional` **dumpCmd?**: `string`

Defined in: [vm-handle.ts:177](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L177)

Command to run in the guest to trigger the CRIU dump. Defaults to
`/sbin/machinen-dump`.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [vm-handle.ts:182](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L182)

Wall-clock ceiling for the dump + shutdown. If the VMM hasn't exited
in this window we SIGKILL it and fail. Default 90s.

##### onLog?

> `optional` **onLog?**: [`OnLog`](#onlog)

Defined in: [vm-handle.ts:188](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L188)

Streaming log callback — fires for every byte the dump emits
(guest console + the dump exec). See #83. When both the snapshot
call and `boot({ onLog })` have a callback set, both fire.

##### leaveRunning?

> `optional` **leaveRunning?**: `boolean`

Defined in: [vm-handle.ts:197](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L197)

Pass `--leave-running` to `criu dump` so the source workload
survives the snapshot. The VMM stays up after the dump; success
is signalled by the dump exec returning 0 instead of by VMM exit.
Used by `vm.fork()` (#216).

Default: false (current destructive snapshot behavior).

##### tcpClose?

> `optional` **tcpClose?**: `boolean`

Defined in: [vm-handle.ts:207](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L207)

Omit `--tcp-established` from `criu dump`. Restored sockets come
back in CLOSED state — the workload sees ECONNRESET on first
I/O, which is the right semantic when the dump is the source for
a fork (otherwise both copies would race on the same connection
state). See #216.

Default: false (preserve TCP — current snapshot/restore behavior).

***

### SnapshotResult

Defined in: [vm-handle.ts:210](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L210)

#### Properties

##### snapDir

> **snapDir**: `string`

Defined in: [vm-handle.ts:212](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L212)

Absolute path to the snapshot bundle directory.

##### diskPath

> **diskPath**: `string`

Defined in: [vm-handle.ts:214](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L214)

Absolute path to the disk image inside the bundle.

##### elapsedMs

> **elapsedMs**: `number`

Defined in: [vm-handle.ts:216](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L216)

Time from `snapshot()` entry to VMM exit, in milliseconds.

##### consoleLog

> **consoleLog**: `string`

Defined in: [vm-handle.ts:218](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L218)

Guest console output captured during the dump.

***

### SnapshotMeta

Defined in: [vm-handle.ts:225](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L225)

On-disk shape of the bundle's `meta.json`. Read by `restore()`
to reconstruct the source VM's name when registering the fork.

#### Properties

##### sourceName?

> `optional` **sourceName?**: `string`

Defined in: [vm-handle.ts:227](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L227)

Name passed to `boot({ name })` when the source VM was started.

##### sourceImage?

> `optional` **sourceImage?**: `string`

Defined in: [vm-handle.ts:236](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L236)

Absolute path of the rootfs tarball the source VM was booted with
(`boot({ image })` or its restored equivalent). `restore()` uses
this as the default rootfs, so the same-host quickstart works
without callers having to repeat the image path. Cross-host
restores need either the path to resolve on the new host, or an
explicit `image` override.

##### snappedAt

> **snappedAt**: `number`

Defined in: [vm-handle.ts:238](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L238)

ms epoch when `vm.snapshot()` returned.

***

### ForkOptions

Defined in: [vm-handle.ts:241](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L241)

#### Properties

##### name?

> `optional` **name?**: `string`

Defined in: [vm-handle.ts:246](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L246)

Name for the forked VM. When omitted, the existing restore()
auto-naming kicks in: `<sourceName>/<fork.pid>`.

##### outDir?

> `optional` **outDir?**: `string`

Defined in: [vm-handle.ts:253](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L253)

If set, the snapshot bundle is written here and kept after the
fork exits — re-restore from this path to spawn another sibling.
If omitted, the bundle is written to a temp dir and removed
when the fork's VMM exits.

##### image?

> `optional` **image?**: `string`

Defined in: [vm-handle.ts:258](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L258)

Override the rootfs image used for the fork's restore boot.
Same semantics as `restore({ image })`.

##### kernel?

> `optional` **kernel?**: `string`

Defined in: [vm-handle.ts:260](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L260)

Kernel path for the fork's boot. Same semantics as `boot({ kernel })`.

##### dtb?

> `optional` **dtb?**: `string`

Defined in: [vm-handle.ts:262](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L262)

DTB path for the fork's boot. Same semantics as `boot({ dtb })`.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [vm-handle.ts:268](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L268)

Wall-clock ceiling for the dump half. Default 90s (matches
`vm.snapshot({ timeoutMs })`). Restore boot has its own
implicit deadlines via `boot()`.

##### onLog?

> `optional` **onLog?**: [`OnLog`](#onlog)

Defined in: [vm-handle.ts:273](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L273)

Streaming log callback for the snapshot half. Same shape as
`vm.snapshot({ onLog })`.

##### tcpKeep?

> `optional` **tcpKeep?**: `boolean`

Defined in: [vm-handle.ts:280](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L280)

Default false: omit `--tcp-established` from the dump so the
fork sees ECONNRESET on sockets the source had open. Set true
to clone live TCP state into the fork (both VMs then race on
the same connection — only correct in narrow scenarios).

##### portForward?

> `optional` **portForward?**: `object`[]

Defined in: [vm-handle.ts:286](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm-handle.ts#L286)

Host→guest port forwards for the fork. NOT inherited from the
source — host ports are global and source + fork would race on
the same bind. Pass explicitly when the fork needs forwards.

###### hostPort

> **hostPort**: `number`

###### guestPort

> **guestPort**: `number`

###### hostAddr?

> `optional` **hostAddr?**: `string`

***

### BootOptions

Defined in: [vm.ts:155](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L155)

#### Properties

##### image?

> `optional` **image?**: `string`

Defined in: [vm.ts:162](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L162)

Path to a rootfs tarball to boot from (e.g. the output of
`provision()`, or `rootfs-debian-arm64.tar.gz` shipped in releases).
Paired with `cmd` — both required, or neither (test-mode binary
boots and snapshot-only restores both skip initramfs packing).

##### cmd?

> `optional` **cmd?**: `string`[]

Defined in: [vm.ts:168](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L168)

Command to run inside the guest. Packed into the synthesized
`/machinen-config.json`. Paired with `image` — both required, or
neither.

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Defined in: [vm.ts:174](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L174)

Env vars exposed to the guest workload. Packed into the synthesized
`/machinen-config.json`. Distinct from `vmmEnv`, which only affects
the host-side VMM process.

##### guestCwd?

> `optional` **guestCwd?**: `string`

Defined in: [vm.ts:186](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L186)

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

Defined in: [vm.ts:207](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L207)

Attach a scratch virtio-blk device (`/dev/vdb`, or `/dev/vda` on
pre-#114 layouts) so this VM can be CRIU-snapshotted later via
`vm.snapshot()`. Three forms:

  - `undefined` (default) — the runtime auto-allocates a per-boot
    ~8 GiB sparse scratch in `tmpdir()` and unlinks it on VM exit.
    Disk usage stays at zero until the guest writes; the upside is
    every booted VM is snapshotable without re-booting. See #50.

  - `'<path>'` — caller-managed file. Used as-is (must exist).
    Required when restoring: pass the snapshot bundle's disk image
    produced by a prior `vm.snapshot()`. The runtime synthesizes
    `cmd: ['/sbin/machinen-restore']` if no other cmd is given.

  - `false` — opt out entirely. No `/dev/vdb` attached. Use when
    you don't need snapshot capability and want to skip the
    (sparse, but still nonzero) inode allocation — typical for
    fast-cycling test boots.

##### rootDisk?

> `optional` **rootDisk?**: `string` \| `boolean`

Defined in: [vm.ts:229](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L229)

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

Defined in: [vm.ts:246](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L246)

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

Defined in: [vm.ts:253](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L253)

Optional name to register this VM under (`attach({ name })`
lookup key). Path-shaped strings ("worker/9012") are allowed.
Names are unique while live — `boot()` throws
`REGISTRY_NAME_IN_USE` if another VM already holds the name.

##### forkedFrom?

> `optional` **forkedFrom?**: `string`

Defined in: [vm.ts:259](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L259)

Bookkeeping: absolute path to the snapshot bundle this VM was
forked from. Set by `restore({ snapDir })`; visible in
`machinen ls`. Plain `boot()` leaves it undefined.

##### mount?

> `optional` **mount?**: `object`

Defined in: [vm.ts:273](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L273)

A single host directory copied into the guest at boot. The guest
path must live under `/mnt/`. Copy-once semantics: guest writes are
discarded when the VM exits. See #64, #78.

The payload rides through the initramfs cpio (overlaid under
`/mnt/<guest>/` at pack time) and is then carried across the
rootdisk pivot by `/init` into the on-disk rootfs. With
`rootDisk: true` (the default) the mount briefly counts against
the initramfs RAM ceiling at unpack — the same ceiling #114 was
designed to relieve for the rootfs proper. For very large mounts
prefer `liveMount` (FUSE pass-through, no copy). See #125.

###### host

> **host**: `string`

###### guest

> **guest**: `string`

##### liveMounts?

> `optional` **liveMounts?**: `object`[]

Defined in: [vm.ts:291](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L291)

Host directories exposed to the guest as live-share FUSE mounts
(#78). Unlike `mount` (copy-once into the boot rootfs), these stay
connected to the host: the guest reads on demand via a vsock FUSE
relay, and nothing is copied at boot. `mode` defaults to `"rw"` —
guest writes land on the host (#151, #156). Set `"ro"` for a
one-way share (host caches, untrusted guests).

Each guest path must live under `/mnt/` (same rule as `mount`).
Repeatable; each entry gets its own vsock port.

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

Defined in: [vm.ts:297](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L297)

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

Defined in: [vm.ts:305](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L305)

Absolute or cwd-relative path to the VMM binary. Optional —
if omitted, `boot()` resolves it via `resolveVmmBinary()`.

##### cwd?

> `optional` **cwd?**: `string`

Defined in: [vm.ts:307](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L307)

Working directory for the VMM (for finding fixture files).

##### args?

> `optional` **args?**: `string`[]

Defined in: [vm.ts:309](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L309)

Extra argv for the VMM.

##### kernel?

> `optional` **kernel?**: `string`

Defined in: [vm.ts:311](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L311)

Path to the guest kernel Image. Forwarded as `MACHINEN_KERNEL`.

##### dtb?

> `optional` **dtb?**: `string`

Defined in: [vm.ts:313](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L313)

Path to the guest device-tree blob. Forwarded as `MACHINEN_DTB`.

##### pdeathsig?

> `optional` **pdeathsig?**: `boolean`

Defined in: [vm.ts:324](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L324)

Wrap the VMM through the parent-death shim so it dies with this
runtime process. Default true — the right answer for the common
"boot, do work, exit" CLI flow.

Set to false when the VMM is supposed to outlive the spawning
process. `vm.fork()` (#216) sets this so the forked sibling
survives `cli fork` returning. Without it, the kqueue-watching
shim catches the CLI exit and SIGTERMs the fork mid-startup.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [vm.ts:329](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L329)

Milliseconds to wait in `wait()` before giving up and rejecting.
Defaults to 60s. Pass `null` to wait forever.

##### vmmEnv?

> `optional` **vmmEnv?**: `Record`\<`string`, `string`\>

Defined in: [vm.ts:334](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L334)

Env passed to the VMM process on the host side (not exposed to the
guest workload). Mostly for dev/test flags like `MACHINEN_BOOT_TEST`.

##### onLog?

> `optional` **onLog?**: [`OnLog`](#onlog)

Defined in: [vm.ts:342](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L342)

Streaming log callback — fires for every byte of guest output:
kernel console (VMM stderr) and every exec invocation made through
the returned handle. See `LogEvent.source` to tell them apart. See
#83. For per-call output-only tees on a single exec, use
`vm.exec({ onStdout, onStderr })` instead.

##### detached?

> `optional` **detached?**: `boolean`

Defined in: [vm.ts:367](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L367)

Detach the VMM from the runtime parent so the parent can exit
while the VM keeps running (issue #150 phase 2). When set, `boot()`
blocks only until the guest produces its first console byte
(readiness signal) and then resolves a handle whose `.wait()` /
`.output()` no longer reflect the live VM — the parent has unrefed
the child and is free to exit.

Forces `pdeathsig: false` (otherwise the parent's exit kills the
VMM, defeating the purpose). Refused in v1 alongside `liveMounts`,
`mount`, and `portForward`: those all keep helpers in the JS
process that the detached VMM still needs to call back into.
Phase 3 lifts those gates by extracting the helpers into
standalone daemons.

Cleanup of per-boot reflink disks, bundle dirs, and vsock UDS
directories normally happens in the parent's `child.once("exit")`
hook. After detach the parent is gone, so those leak until the
follow-up `machinen gc` / `machinen stop` commands (PR2 of #150)
land. Use `--detached` only when you understand that trade-off.

Reattach with `attach({ name | pid })` from another process —
the registry entry stays live, the vsock UDS is still listening.

***

### AttachOptions

Defined in: [vm.ts:1364](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L1364)

#### Properties

##### pid?

> `optional` **pid?**: `number`

Defined in: [vm.ts:1370](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L1370)

Look up a VM by the host pid of its VMM process. Kernel-unique
while alive; mutually exclusive with `name`. Exactly one of
`pid` / `name` is required.

##### name?

> `optional` **name?**: `string`

Defined in: [vm.ts:1372](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L1372)

Look up a VM by the name passed to `boot({ name })`.

##### onLog?

> `optional` **onLog?**: [`OnLog`](#onlog)

Defined in: [vm.ts:1379](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L1379)

Streaming log callback — fires for every byte of output from execs
made through the returned handle. See #83. Guest kernel console is
not available on attach handles (it belongs to the process that
called `boot()`), so only `exec-stdout` / `exec-stderr` sources fire.

***

### RestoreOptions

Defined in: [vm.ts:2523](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L2523)

#### Extends

- `Omit`\<[`BootOptions`](#bootoptions), `"snapshot"` \| `"image"` \| `"cmd"` \| `"name"`\>

#### Properties

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Defined in: [vm.ts:174](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L174)

Env vars exposed to the guest workload. Packed into the synthesized
`/machinen-config.json`. Distinct from `vmmEnv`, which only affects
the host-side VMM process.

###### Inherited from

[`BootOptions`](#bootoptions).[`env`](#env-4)

##### guestCwd?

> `optional` **guestCwd?**: `string`

Defined in: [vm.ts:186](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L186)

Working directory for the guest cmd. Lands as `cwd` in the
synthesized `/machinen-config.json`; `/init` calls `chdir()` to
this path before exec'ing the cmd. Useful with `mount` /
`liveMounts` to land directly inside the share (e.g.
`guestCwd: "/mnt/workspace"`).

Must be absolute. Throws `BOOT_CWD_INVALID` for relative paths or
paths containing NULs. Same precedence as `cmd`/`env`: an
image-baked `cwd` is overridden by this field when both are set.

###### Inherited from

[`BootOptions`](#bootoptions).[`guestCwd`](#guestcwd)

##### rootDisk?

> `optional` **rootDisk?**: `string` \| `boolean`

Defined in: [vm.ts:229](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L229)

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

[`BootOptions`](#bootoptions).[`rootDisk`](#rootdisk)

##### rootDiskSizeBytes?

> `optional` **rootDiskSizeBytes?**: `number`

Defined in: [vm.ts:246](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L246)

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

[`BootOptions`](#bootoptions).[`rootDiskSizeBytes`](#rootdisksizebytes)

##### forkedFrom?

> `optional` **forkedFrom?**: `string`

Defined in: [vm.ts:259](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L259)

Bookkeeping: absolute path to the snapshot bundle this VM was
forked from. Set by `restore({ snapDir })`; visible in
`machinen ls`. Plain `boot()` leaves it undefined.

###### Inherited from

[`BootOptions`](#bootoptions).[`forkedFrom`](#forkedfrom-1)

##### mount?

> `optional` **mount?**: `object`

Defined in: [vm.ts:273](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L273)

A single host directory copied into the guest at boot. The guest
path must live under `/mnt/`. Copy-once semantics: guest writes are
discarded when the VM exits. See #64, #78.

The payload rides through the initramfs cpio (overlaid under
`/mnt/<guest>/` at pack time) and is then carried across the
rootdisk pivot by `/init` into the on-disk rootfs. With
`rootDisk: true` (the default) the mount briefly counts against
the initramfs RAM ceiling at unpack — the same ceiling #114 was
designed to relieve for the rootfs proper. For very large mounts
prefer `liveMount` (FUSE pass-through, no copy). See #125.

###### host

> **host**: `string`

###### guest

> **guest**: `string`

###### Inherited from

[`BootOptions`](#bootoptions).[`mount`](#mount-2)

##### liveMounts?

> `optional` **liveMounts?**: `object`[]

Defined in: [vm.ts:291](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L291)

Host directories exposed to the guest as live-share FUSE mounts
(#78). Unlike `mount` (copy-once into the boot rootfs), these stay
connected to the host: the guest reads on demand via a vsock FUSE
relay, and nothing is copied at boot. `mode` defaults to `"rw"` —
guest writes land on the host (#151, #156). Set `"ro"` for a
one-way share (host caches, untrusted guests).

Each guest path must live under `/mnt/` (same rule as `mount`).
Repeatable; each entry gets its own vsock port.

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

[`BootOptions`](#bootoptions).[`liveMounts`](#livemounts)

##### portForward?

> `optional` **portForward?**: `object`[]

Defined in: [vm.ts:297](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L297)

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

Defined in: [vm.ts:305](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L305)

Absolute or cwd-relative path to the VMM binary. Optional —
if omitted, `boot()` resolves it via `resolveVmmBinary()`.

###### Inherited from

[`BootOptions`](#bootoptions).[`binary`](#binary-2)

##### cwd?

> `optional` **cwd?**: `string`

Defined in: [vm.ts:307](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L307)

Working directory for the VMM (for finding fixture files).

###### Inherited from

[`BootOptions`](#bootoptions).[`cwd`](#cwd-2)

##### args?

> `optional` **args?**: `string`[]

Defined in: [vm.ts:309](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L309)

Extra argv for the VMM.

###### Inherited from

[`BootOptions`](#bootoptions).[`args`](#args-1)

##### kernel?

> `optional` **kernel?**: `string`

Defined in: [vm.ts:311](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L311)

Path to the guest kernel Image. Forwarded as `MACHINEN_KERNEL`.

###### Inherited from

[`BootOptions`](#bootoptions).[`kernel`](#kernel-2)

##### dtb?

> `optional` **dtb?**: `string`

Defined in: [vm.ts:313](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L313)

Path to the guest device-tree blob. Forwarded as `MACHINEN_DTB`.

###### Inherited from

[`BootOptions`](#bootoptions).[`dtb`](#dtb-2)

##### pdeathsig?

> `optional` **pdeathsig?**: `boolean`

Defined in: [vm.ts:324](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L324)

Wrap the VMM through the parent-death shim so it dies with this
runtime process. Default true — the right answer for the common
"boot, do work, exit" CLI flow.

Set to false when the VMM is supposed to outlive the spawning
process. `vm.fork()` (#216) sets this so the forked sibling
survives `cli fork` returning. Without it, the kqueue-watching
shim catches the CLI exit and SIGTERMs the fork mid-startup.

###### Inherited from

[`BootOptions`](#bootoptions).[`pdeathsig`](#pdeathsig)

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [vm.ts:329](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L329)

Milliseconds to wait in `wait()` before giving up and rejecting.
Defaults to 60s. Pass `null` to wait forever.

###### Inherited from

[`BootOptions`](#bootoptions).[`timeoutMs`](#timeoutms-5)

##### vmmEnv?

> `optional` **vmmEnv?**: `Record`\<`string`, `string`\>

Defined in: [vm.ts:334](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L334)

Env passed to the VMM process on the host side (not exposed to the
guest workload). Mostly for dev/test flags like `MACHINEN_BOOT_TEST`.

###### Inherited from

[`BootOptions`](#bootoptions).[`vmmEnv`](#vmmenv-1)

##### onLog?

> `optional` **onLog?**: [`OnLog`](#onlog)

Defined in: [vm.ts:342](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L342)

Streaming log callback — fires for every byte of guest output:
kernel console (VMM stderr) and every exec invocation made through
the returned handle. See `LogEvent.source` to tell them apart. See
#83. For per-call output-only tees on a single exec, use
`vm.exec({ onStdout, onStderr })` instead.

###### Inherited from

[`BootOptions`](#bootoptions).[`onLog`](#onlog-4)

##### detached?

> `optional` **detached?**: `boolean`

Defined in: [vm.ts:367](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L367)

Detach the VMM from the runtime parent so the parent can exit
while the VM keeps running (issue #150 phase 2). When set, `boot()`
blocks only until the guest produces its first console byte
(readiness signal) and then resolves a handle whose `.wait()` /
`.output()` no longer reflect the live VM — the parent has unrefed
the child and is free to exit.

Forces `pdeathsig: false` (otherwise the parent's exit kills the
VMM, defeating the purpose). Refused in v1 alongside `liveMounts`,
`mount`, and `portForward`: those all keep helpers in the JS
process that the detached VMM still needs to call back into.
Phase 3 lifts those gates by extracting the helpers into
standalone daemons.

Cleanup of per-boot reflink disks, bundle dirs, and vsock UDS
directories normally happens in the parent's `child.once("exit")`
hook. After detach the parent is gone, so those leak until the
follow-up `machinen gc` / `machinen stop` commands (PR2 of #150)
land. Use `--detached` only when you understand that trade-off.

Reattach with `attach({ name | pid })` from another process —
the registry entry stays live, the vsock UDS is still listening.

###### Inherited from

[`BootOptions`](#bootoptions).[`detached`](#detached)

##### snapDir

> **snapDir**: `string`

Defined in: [vm.ts:2528](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L2528)

Snapshot bundle directory produced by `vm.snapshot()`.
Must contain `disk.img` and `meta.json`.

##### image?

> `optional` **image?**: `string`

Defined in: [vm.ts:2536](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L2536)

Override the rootfs image used for the restore boot. Defaults
to whatever caller passes through `image`-equivalent — but
`restore()` always needs a base rootfs in the initramfs to
carry /sbin/machinen-restore + criu. Most callers pass the
release rootfs path here.

##### name?

> `optional` **name?**: `string`

Defined in: [vm.ts:2542](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L2542)

Optional explicit name for the restored VM. When omitted, the
fork is auto-named `<sourceName>/<pid>` after spawn so it stays
unique under the source's namespace.

***

### VsockWinsizeOptions

Defined in: [winsize.ts:30](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/winsize.ts#L30)

#### Properties

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [winsize.ts:32](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/winsize.ts#L32)

How long to keep retrying the UDS connect. Default 10s.

##### retryMs?

> `optional` **retryMs?**: `number`

Defined in: [winsize.ts:34](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/winsize.ts#L34)

Poll interval in ms while retrying. Default 250.

## Type Aliases

### ErrorCode

> **ErrorCode** = *typeof* [`ErrorCode`](#errorcode)\[keyof *typeof* [`ErrorCode`](#errorcode)\]

Defined in: [errors.ts:23](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L23)

***

### LogEvent

> **LogEvent** = [`ChunkLogEvent`](#chunklogevent) \| [`PhaseLogEvent`](#phaselogevent)

Defined in: [log.ts:43](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/log.ts#L43)

***

### OnLog

> **OnLog** = (`evt`) => `void`

Defined in: [log.ts:45](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/log.ts#L45)

#### Parameters

##### evt

[`LogEvent`](#logevent)

#### Returns

`void`

***

### PidStatus

> **PidStatus** = `"alive"` \| `"dead"` \| `"recycled"`

Defined in: [pid-validate.ts:44](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pid-validate.ts#L44)

Result of `validatePid` — easy to switch on at the call site.

***

### ImageConfig

> **ImageConfig** = `object`

Defined in: [vm.ts:1556](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L1556)

Shape of the optional `./machinen-config.json` baked into a rootfs
tarball by `provision({ cmd, env })`. `boot()` reads it via
`readImageConfig()` so callers don't need to re-pass `cmd`/`env` on
every boot. `warmImageConfigCache()` accepts the same shape so a
tarball-producing tool can pre-populate the lookup cache.

#### Properties

##### cmd?

> `optional` **cmd?**: `string`[]

Defined in: [vm.ts:1556](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L1556)

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Defined in: [vm.ts:1556](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L1556)

##### cwd?

> `optional` **cwd?**: `string`

Defined in: [vm.ts:1556](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L1556)

## Variables

### ErrorCode

> `const` **ErrorCode**: `object`

Defined in: [errors.ts:23](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L23)

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

##### BOOT\_DETACHED\_INCOMPATIBLE

> `readonly` **BOOT\_DETACHED\_INCOMPATIBLE**: `"BOOT_DETACHED_INCOMPATIBLE"` = `"BOOT_DETACHED_INCOMPATIBLE"`

##### BOOT\_DETACHED\_READINESS\_FAILED

> `readonly` **BOOT\_DETACHED\_READINESS\_FAILED**: `"BOOT_DETACHED_READINESS_FAILED"` = `"BOOT_DETACHED_READINESS_FAILED"`

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

##### SNAPSHOT\_LIVE\_MOUNT\_ACTIVE

> `readonly` **SNAPSHOT\_LIVE\_MOUNT\_ACTIVE**: `"SNAPSHOT_LIVE_MOUNT_ACTIVE"` = `"SNAPSHOT_LIVE_MOUNT_ACTIVE"`

##### PROVISION\_BASE\_NOT\_FOUND

> `readonly` **PROVISION\_BASE\_NOT\_FOUND**: `"PROVISION_BASE_NOT_FOUND"` = `"PROVISION_BASE_NOT_FOUND"`

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

Defined in: [exec.ts:62](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L62)

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

Defined in: [files.ts:34](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/files.ts#L34)

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

### VsockSecrets

> `const` **VsockSecrets**: `object`

Defined in: [secrets.ts:33](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/secrets.ts#L33)

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

Defined in: [vm.ts:2125](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L2125)

#### Type Declaration

##### collect

> **collect**: (`stream`, `capBytes`) => `Promise`\<`string`\>

###### Parameters

###### stream

`Readable`

###### capBytes?

`number` = `CONSOLE_TAIL_BYTES`

###### Returns

`Promise`\<`string`\>

##### CONSOLE\_TAIL\_BYTES

> **CONSOLE\_TAIL\_BYTES**: `number`

Cap on bytes retained per stream by `collect()`. Each VM session keeps
the *last* this-many bytes of stdout/stderr; older bytes are dropped.
The kernel boot console fits well under this, snapshot debugging only
uses the last ~2 KB, and a multi-hour idle VM no longer accumulates
gigabytes of console chatter in the supervisor's heap (issue #150).

## Functions

### detachedLogRoot()

> **detachedLogRoot**(): `string`

Defined in: [detached-log.ts:28](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/detached-log.ts#L28)

Default directory for `<pid>.boot.log` snapshots. Honors
`MACHINEN_DETACHED_LOG_DIR` so tests can scope writes to a tmpdir
without scribbling under `$HOME`.

#### Returns

`string`

***

### bootSnapshotPath()

> **bootSnapshotPath**(`pid`): `string`

Defined in: [detached-log.ts:33](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/detached-log.ts#L33)

Path the next snapshot for `pid` will be written to.

#### Parameters

##### pid

`number`

#### Returns

`string`

***

### writeBootSnapshot()

> **writeBootSnapshot**(`path`, `contents`): `boolean`

Defined in: [detached-log.ts:44](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/detached-log.ts#L44)

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

Defined in: [errors.ts:167](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L167)

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

Defined in: [errors.ts:176](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L176)

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

Defined in: [gc.ts:52](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/gc.ts#L52)

Walk the registry; for each entry that's dead or pid-recycled,
remove its cleanupPaths + bootLog + registry entry. Returns one
result per entry processed (live entries are skipped silently).

#### Parameters

##### opts?

[`RunGcOptions`](#rungcoptions) = `{}`

#### Returns

[`GcResult`](#gcresult)[]

***

### mkinitramfsBundle()

> **mkinitramfsBundle**(`opts`): `void`

Defined in: [mkinitramfs.ts:365](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L365)

#### Parameters

##### opts

[`PackBundleOptions`](#packbundleoptions)

#### Returns

`void`

***

### mkinitramfsTinyBundle()

> **mkinitramfsTinyBundle**(`opts`): `void`

Defined in: [mkinitramfs.ts:534](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L534)

Build the tiny initramfs used by every user-facing boot() (#119).

Layout:
  /init                        compiled Zig init
  /machinen-config.json        cmd/env/cwd/liveMounts for /init
  /etc/machinen-boot-epoch     wall clock seed for the guest
  /dev/console                 char node 5,1 — kernel needs it before
                               /init re-opens the console
  /fuse-agent                  optional, only when liveMounts
  /mnt/<guest>/                optional, when caller passed `mount`
  /tmp                         sticky 1777

No /lib/modules tree, no kmod, no /modules/*.ko, no Debian userland.
The custom kernel ships with virtio_*, ext4, and vsock built in
(scripts/build-kernel-arm64.sh), so /init pivots straight into
/dev/vda without a finit_module pass.

#### Parameters

##### opts

[`PackTinyBundleOptions`](#packtinybundleoptions)

#### Returns

`void`

***

### mkinitramfsRootfs()

> **mkinitramfsRootfs**(`opts`): `void`

Defined in: [mkinitramfs.ts:626](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L626)

#### Parameters

##### opts

[`PackRootfsOptions`](#packrootfsoptions)

#### Returns

`void`

***

### mkinitramfsMinimal()

> **mkinitramfsMinimal**(`opts`): `void`

Defined in: [mkinitramfs.ts:646](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L646)

#### Parameters

##### opts

[`PackMinimalOptions`](#packminimaloptions)

#### Returns

`void`

***

### mkinitramfsWorkspace()

> **mkinitramfsWorkspace**(`opts`): `void`

Defined in: [mkinitramfs.ts:672](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L672)

#### Parameters

##### opts

[`PackWorkspaceOptions`](#packworkspaceoptions)

#### Returns

`void`

***

### mkinitramfsCli()

> **mkinitramfsCli**(`argv`): `void`

Defined in: [mkinitramfs.ts:838](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L838)

Invoked by the CLI shim at packages/microvm/test-fixtures/assets/mkinitramfs.ts.
Kept argv-compatible with the old Python script so shell fixtures
(smoke.sh, try.sh, handoff.sh) don't need deeper changes.

#### Parameters

##### argv

`string`[]

#### Returns

`void`

***

### validatePid()

> **validatePid**(`pid`, `expected`): [`PidStatus`](#pidstatus)

Defined in: [pid-validate.ts:60](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pid-validate.ts#L60)

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

### resolveBaseRootfs()

> **resolveBaseRootfs**(`explicit?`, `cwd?`): `string`

Defined in: [provision.ts:192](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L192)

Resolve the path to the base rootfs tarball, in the same order
`provision()` itself does:

  1. `explicit` — the caller-supplied path (resolved against `cwd`).
  2. `MACHINEN_ASSETS_DIR` env var — points at a directory laid out like
     `scripts/build-base-assets.sh`'s output (contains
     `rootfs-debian-arm64.tar.gz`). Same convention `@machinen/cli`
     honors for local/dev builds.
  3. `@machinen/cli`'s on-disk cache at
     `~/.machinen/@machinen/runtime@<version>/bases/debian-arm64/rootfs.tar.gz`.
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

### provision()

> **provision**(`opts`): `Promise`\<[`ProvisionResult`](#provisionresult)\>

Defined in: [provision.ts:253](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L253)

Boot the base rootfs, run the user install hook, and freeze the
resulting filesystem state to a new tarball at `opts.out`.

#### Parameters

##### opts

[`ProvisionOptions`](#provisionoptions)

#### Returns

`Promise`\<[`ProvisionResult`](#provisionresult)\>

#### Throws

PROVISION_BASE_NOT_FOUND |
  PROVISION_ASSETS_DIR_INVALID | PROVISION_INSTALL_HOOK_FAILED |
  PROVISION_DISK_TOO_SMALL

#### Throws

see `boot()` — propagated from the inner boot

***

### bootPty()

> **bootPty**(`opts`): [`PtyVmHandle`](#ptyvmhandle)

Defined in: [pty.ts:125](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L125)

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

Defined in: [registry.ts:120](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L120)

Absolute path to the registry root. Honors `MACHINEN_REGISTRY_DIR`
so tests can point at a scratch dir without stomping on real entries.

#### Returns

`string`

***

### list()

> **list**(): [`RegistryEntry`](#registryentry)[]

Defined in: [registry.ts:256](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L256)

List all registry entries whose pid is still alive. Prunes stale
entries (pid no longer alive) and orphaned name pins as a side
effect, so a crashed VMM doesn't leave a stuck record behind.

#### Returns

[`RegistryEntry`](#registryentry)[]

***

### rootfsImgCacheDir()

> **rootfsImgCacheDir**(): `string`

Defined in: [rootfs-img.ts:86](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/rootfs-img.ts#L86)

Default cache root: `~/.cache/machinen/rootfs`.

#### Returns

`string`

***

### markRootfsImageClean()

> **markRootfsImageClean**(`imgPath`): `void`

Defined in: [rootfs-img.ts:106](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/rootfs-img.ts#L106)

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

Defined in: [rootfs-img.ts:205](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/rootfs-img.ts#L205)

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

Defined in: [rootfs-img.ts:729](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/rootfs-img.ts#L729)

Resolve the mke2fs binary path using the same lookup order as
`ensureRootfsImage` itself: env override → bundled package → PATH →
Homebrew keg-only. Returns `undefined` when no binary is available
(callers should treat this as "skip the optimization", not an error).

Exported so `provision()` can prebake an `<out>.img.gz` sibling
alongside its `<out>.tar.gz` output (#233 follow-up). Without that,
every fresh `provision()` invalidates the cached `<sha>.img` and the
next `boot()` pays ~10 s for tar-extract + mke2fs.

#### Returns

`string`

***

### resolveVmmBinary()

> **resolveVmmBinary**(): `string`

Defined in: [vm.ts:117](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L117)

Locate the VMM binary using the same lookup order as `@machinen/cli`:
  1. `MACHINEN_VMM` env var (dev-mode override)
  2. `require.resolve("@machinen/vmm-<arch>-<os>")` → `binary` export

Callers can pass an explicit `binary` to `boot()` to bypass this.

#### Returns

`string`

#### Throws

BOOT_VMM_MISSING | BOOT_VMM_PACKAGE_BROKEN

***

### boot()

> **boot**(`opts?`): `Promise`\<[`VmHandle`](#vmhandle)\>

Defined in: [vm.ts:382](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L382)

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

### attach()

> **attach**(`opts`): `Promise`\<[`VmHandle`](#vmhandle)\>

Defined in: [vm.ts:1395](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L1395)

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

### warmImageConfigCache()

> **warmImageConfigCache**(`imagePath`, `config`): `void`

Defined in: [vm.ts:1601](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L1601)

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

### buildWriteFileCmd()

> **buildWriteFileCmd**(`guestPath`, `contents`, `opts?`): `string`

Defined in: [vm.ts:1973](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L1973)

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

Defined in: [vm.ts:2015](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L2015)

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

### restore()

> **restore**(`opts`): `Promise`\<[`VmHandle`](#vmhandle)\>

Defined in: [vm.ts:2561](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L2561)

Restore a microVM from a snapshot bundle produced by
`vm.snapshot({ outDir })`. Reads the bundle's `meta.json` to
recover the source name, then `boot()`s with the right knobs:

  - `snapshot: <snapDir>/disk.img`  attaches the dump as /dev/vda
  - `name: <sourceName>/<pid>`      auto-named fork (unless caller
                                    passed `name`)
  - `forkedFrom: <snapDir>`         lineage for `machinen ls`

The auto-name uses pid because pids are kernel-unique-while-live
and we get one for free after spawn — no extra counter state.

#### Parameters

##### opts

[`RestoreOptions`](#restoreoptions)

#### Returns

`Promise`\<[`VmHandle`](#vmhandle)\>

#### Throws

BOOT_SNAPSHOT_NOT_FOUND if `<snapDir>/disk.img`
  is missing.

***

### measureFirstByte()

> **measureFirstByte**(`vm`): `Promise`\<`number`\>

Defined in: [vm.ts:2858](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/vm.ts#L2858)

Time-to-first-output-byte for a boot. Useful for measuring how
much the snapshot path is (or isn't) buying us.

#### Parameters

##### vm

[`VmHandle`](#vmhandle)

#### Returns

`Promise`\<`number`\>

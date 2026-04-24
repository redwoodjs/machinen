# @machinen/runtime

## Classes

### MachinenError

Defined in: [errors.ts:119](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L119)

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

Defined in: [errors.ts:123](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L123)

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

Defined in: [errors.ts:120](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L120)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:121](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L121)

***

### BootError

Defined in: [errors.ts:132](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L132)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new BootError**(`code`, `message`, `opts?`): [`BootError`](#booterror)

Defined in: [errors.ts:123](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L123)

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

Defined in: [errors.ts:120](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L120)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:121](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L121)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### ExecError

Defined in: [errors.ts:133](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L133)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new ExecError**(`code`, `message`, `opts?`): [`ExecError`](#execerror)

Defined in: [errors.ts:123](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L123)

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

Defined in: [errors.ts:120](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L120)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:121](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L121)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### SnapshotError

Defined in: [errors.ts:134](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L134)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new SnapshotError**(`code`, `message`, `opts?`): [`SnapshotError`](#snapshoterror)

Defined in: [errors.ts:123](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L123)

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

Defined in: [errors.ts:120](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L120)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:121](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L121)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### ProvisionError

Defined in: [errors.ts:135](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L135)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new ProvisionError**(`code`, `message`, `opts?`): [`ProvisionError`](#provisionerror)

Defined in: [errors.ts:123](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L123)

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

Defined in: [errors.ts:120](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L120)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:121](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L121)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### RegistryError

Defined in: [errors.ts:136](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L136)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new RegistryError**(`code`, `message`, `opts?`): [`RegistryError`](#registryerror)

Defined in: [errors.ts:123](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L123)

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

Defined in: [errors.ts:120](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L120)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:121](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L121)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### FilesError

Defined in: [errors.ts:137](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L137)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new FilesError**(`code`, `message`, `opts?`): [`FilesError`](#fileserror)

Defined in: [errors.ts:123](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L123)

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

Defined in: [errors.ts:120](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L120)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:121](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L121)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### SecretsError

Defined in: [errors.ts:138](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L138)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new SecretsError**(`code`, `message`, `opts?`): [`SecretsError`](#secretserror)

Defined in: [errors.ts:123](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L123)

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

Defined in: [errors.ts:120](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L120)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:121](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L121)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### WinsizeError

Defined in: [errors.ts:139](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L139)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new WinsizeError**(`code`, `message`, `opts?`): [`WinsizeError`](#winsizeerror)

Defined in: [errors.ts:123](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L123)

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

Defined in: [errors.ts:120](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L120)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:121](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L121)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### SandboxError

Defined in: [errors.ts:140](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L140)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new SandboxError**(`code`, `message`, `opts?`): [`SandboxError`](#sandboxerror)

Defined in: [errors.ts:123](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L123)

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

Defined in: [errors.ts:120](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L120)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:121](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L121)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### CacheError

Defined in: [errors.ts:141](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L141)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new CacheError**(`code`, `message`, `opts?`): [`CacheError`](#cacheerror)

Defined in: [errors.ts:123](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L123)

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

Defined in: [errors.ts:120](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L120)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:121](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L121)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### GvproxyError

Defined in: [errors.ts:142](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L142)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new GvproxyError**(`code`, `message`, `opts?`): [`GvproxyError`](#gvproxyerror)

Defined in: [errors.ts:123](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L123)

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

Defined in: [errors.ts:120](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L120)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:121](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L121)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### MkinitramfsError

Defined in: [errors.ts:143](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L143)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new MkinitramfsError**(`code`, `message`, `opts?`): [`MkinitramfsError`](#mkinitramfserror)

Defined in: [errors.ts:123](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L123)

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

Defined in: [errors.ts:120](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L120)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:121](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L121)

###### Inherited from

[`MachinenError`](#machinenerror).[`retryable`](#retryable-1)

***

### ParseError

Defined in: [errors.ts:144](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L144)

Base class for every error raised by @machinen/runtime and
@machinen/cli. Carries a flat `code`, a `retryable` hint, and the
underlying cause via the standard `Error.cause` mechanism.

#### Extends

- [`MachinenError`](#machinenerror)

#### Constructors

##### Constructor

> **new ParseError**(`code`, `message`, `opts?`): [`ParseError`](#parseerror)

Defined in: [errors.ts:123](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L123)

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

Defined in: [errors.ts:120](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L120)

###### Inherited from

[`MachinenError`](#machinenerror).[`code`](#code)

##### retryable

> `readonly` **retryable**: `boolean`

Defined in: [errors.ts:121](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L121)

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

Defined in: [multiplex.ts:55](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L55)

###### Parameters

###### id

`string`

###### vm

[`VmHandle`](#vmhandle)

###### Returns

`void`

##### remove()

> **remove**(`id`): `void`

Defined in: [multiplex.ts:79](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L79)

Remove a sandbox. Does not kill the VM — call `vm.kill()` first.

###### Parameters

###### id

`string`

###### Returns

`void`

##### list()

> **list**(): `object`[]

Defined in: [multiplex.ts:84](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L84)

###### Returns

`object`[]

##### get()

> **get**(`id`): [`SandboxEntry`](#sandboxentry)

Defined in: [multiplex.ts:91](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L91)

###### Parameters

###### id

`string`

###### Returns

[`SandboxEntry`](#sandboxentry)

##### send()

> **send**(`id`, `data`): `boolean`

Defined in: [multiplex.ts:96](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L96)

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

Defined in: [multiplex.ts:110](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L110)

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

Defined in: [multiplex.ts:176](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L176)

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

Defined in: [multiplex.ts:192](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L192)

###### Parameters

###### opts

[`SupervisorOptions`](#supervisoroptions)

###### Returns

[`Supervisor`](#supervisor)

#### Properties

##### sandboxes

> `readonly` **sandboxes**: [`Sandboxes`](#sandboxes)

Defined in: [multiplex.ts:177](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L177)

#### Methods

##### run()

> **run**(): `Promise`\<`void`\>

Defined in: [multiplex.ts:206](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L206)

Run until stopped. Resolves when input ends or stop() is called.

###### Returns

`Promise`\<`void`\>

##### stop()

> **stop**(): `void`

Defined in: [multiplex.ts:223](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L223)

Programmatic stop (e.g. from a test).

###### Returns

`void`

##### attach()

> **attach**(`id`): `void`

Defined in: [multiplex.ts:233](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L233)

Attach to `id`. Throws if id doesn't exist.

###### Parameters

###### id

`string`

###### Returns

`void`

##### detach()

> **detach**(): `void`

Defined in: [multiplex.ts:262](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L262)

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

Defined in: [winsize.ts:85](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/winsize.ts#L85)

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

Defined in: [winsize.ts:96](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/winsize.ts#L96)

###### Returns

`void`

## Interfaces

### ArtifactCacheHandle

Defined in: [artifact-cache.ts:34](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/artifact-cache.ts#L34)

#### Properties

##### port

> **port**: `number`

Defined in: [artifact-cache.ts:36](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/artifact-cache.ts#L36)

Port the cache is listening on (127.0.0.1:<port>).

##### cacheDir

> **cacheDir**: `string`

Defined in: [artifact-cache.ts:38](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/artifact-cache.ts#L38)

Absolute path to the on-disk cache root.

##### stop

> **stop**: () => `Promise`\<`void`\>

Defined in: [artifact-cache.ts:40](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/artifact-cache.ts#L40)

Shut the server down and close its sockets. Idempotent.

###### Returns

`Promise`\<`void`\>

***

### ArtifactCacheOptions

Defined in: [artifact-cache.ts:43](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/artifact-cache.ts#L43)

#### Properties

##### cacheDir?

> `optional` **cacheDir?**: `string`

Defined in: [artifact-cache.ts:49](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/artifact-cache.ts#L49)

Root directory for on-disk caches. Each kind lives under
`<cacheDir>/<kind>/`. Defaults to `$MACHINEN_CACHE_DIR` if set,
else `~/.machinen/cache`.

***

### MachinenErrorOptions

Defined in: [errors.ts:102](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L102)

#### Properties

##### retryable?

> `optional` **retryable?**: `boolean`

Defined in: [errors.ts:109](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L109)

True if retrying the same call could plausibly succeed (transient
network blip, upstream fetch, vsock agent not listening yet). False
for misconfiguration (missing binary, bad mount path, invalid
port).

##### cause?

> `optional` **cause?**: `unknown`

Defined in: [errors.ts:111](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L111)

Underlying error preserved via the standard `Error.cause` chain.

***

### VsockExecOptions

Defined in: [exec.ts:27](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L27)

#### Properties

##### connectTimeoutMs?

> `optional` **connectTimeoutMs?**: `number`

Defined in: [exec.ts:29](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L29)

How long to keep retrying the UDS connect. Default 30s.

##### retryMs?

> `optional` **retryMs?**: `number`

Defined in: [exec.ts:31](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L31)

Poll interval in ms while retrying. Default 250.

##### execTimeoutMs?

> `optional` **execTimeoutMs?**: `number`

Defined in: [exec.ts:33](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L33)

Cap total time spent on this command. Default 5 minutes.

##### onStdout?

> `optional` **onStdout?**: (`chunk`) => `void`

Defined in: [exec.ts:35](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L35)

Called with each stdout chunk as it arrives (pass-through tee).

###### Parameters

###### chunk

`Buffer`

###### Returns

`void`

##### onStderr?

> `optional` **onStderr?**: (`chunk`) => `void`

Defined in: [exec.ts:37](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L37)

Called with each stderr chunk as it arrives (pass-through tee).

###### Parameters

###### chunk

`Buffer`

###### Returns

`void`

***

### VsockExecResult

Defined in: [exec.ts:40](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L40)

#### Properties

##### exitCode

> **exitCode**: `number`

Defined in: [exec.ts:41](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L41)

##### stdout

> **stdout**: `string`

Defined in: [exec.ts:42](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L42)

##### stderr

> **stderr**: `string`

Defined in: [exec.ts:43](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L43)

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

### BootOptions

Defined in: [index.ts:157](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L157)

#### Properties

##### image?

> `optional` **image?**: `string`

Defined in: [index.ts:164](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L164)

Path to a rootfs tarball to boot from (e.g. the output of
`provision()`, or `rootfs-debian-arm64.tar.gz` shipped in releases).
Paired with `cmd` — both required, or neither (test-mode binary
boots and snapshot-only restores both skip initramfs packing).

##### cmd?

> `optional` **cmd?**: `string`[]

Defined in: [index.ts:170](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L170)

Command to run inside the guest. Packed into the synthesized
`/machinen-config.json`. Paired with `image` — both required, or
neither.

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Defined in: [index.ts:176](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L176)

Env vars exposed to the guest workload. Packed into the synthesized
`/machinen-config.json`. Distinct from `vmmEnv`, which only affects
the host-side VMM process.

##### snapshot?

> `optional` **snapshot?**: `string`

Defined in: [index.ts:182](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L182)

Attach this host file as `/dev/vda` inside the guest. Typically a
CRIU snapshot image produced by `vm.snapshot()`, for a sub-second
restore on boot. See #47 (virtio-blk) and #50.

##### mount?

> `optional` **mount?**: `object`

Defined in: [index.ts:188](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L188)

A single host directory copied into the guest at boot. The guest
path must live under `/mnt/`. Copy-once semantics: guest writes are
discarded when the VM exits. See #64, #78.

###### host

> **host**: `string`

###### guest

> **guest**: `string`

##### portForward?

> `optional` **portForward?**: `object`[]

Defined in: [index.ts:194](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L194)

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

Defined in: [index.ts:202](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L202)

Absolute or cwd-relative path to the VMM binary. Optional —
if omitted, `boot()` resolves it via `resolveVmmBinary()`.

##### cwd?

> `optional` **cwd?**: `string`

Defined in: [index.ts:204](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L204)

Working directory for the VMM (for finding fixture files).

##### args?

> `optional` **args?**: `string`[]

Defined in: [index.ts:206](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L206)

Extra argv for the VMM.

##### kernel?

> `optional` **kernel?**: `string`

Defined in: [index.ts:208](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L208)

Path to the guest kernel Image. Forwarded as `MACHINEN_KERNEL`.

##### dtb?

> `optional` **dtb?**: `string`

Defined in: [index.ts:210](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L210)

Path to the guest device-tree blob. Forwarded as `MACHINEN_DTB`.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [index.ts:215](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L215)

Milliseconds to wait in `wait()` before giving up and rejecting.
Defaults to 60s. Pass `null` to wait forever.

##### vmmEnv?

> `optional` **vmmEnv?**: `Record`\<`string`, `string`\>

Defined in: [index.ts:220](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L220)

Env passed to the VMM process on the host side (not exposed to the
guest workload). Mostly for dev/test flags like `MACHINEN_BOOT_TEST`.

##### name?

> `optional` **name?**: `string`

Defined in: [index.ts:226](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L226)

Optional human-friendly name for this VM. When set, `attach({ name })`
can reconnect from another process. Auto-assigned id is always set;
name is just for discovery.

##### onLog?

> `optional` **onLog?**: [`OnLog`](#onlog-3)

Defined in: [index.ts:234](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L234)

Streaming log callback — fires for every byte of guest output:
kernel console (VMM stderr) and every exec invocation made through
the returned handle. See `LogEvent.source` to tell them apart. See
#83. For per-call output-only tees on a single exec, use
`vm.exec({ onStdout, onStderr })` instead.

***

### VmHandle

Defined in: [index.ts:237](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L237)

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [index.ts:239](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L239)

Auto-generated short id registered at boot. Stable across attach.

##### name?

> `readonly` `optional` **name?**: `string`

Defined in: [index.ts:241](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L241)

Optional human-friendly name passed to `boot({ name })`.

##### pid

> `readonly` **pid**: `number`

Defined in: [index.ts:242](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L242)

##### stdin

> `readonly` **stdin**: `Writable`

Defined in: [index.ts:243](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L243)

##### stdout

> `readonly` **stdout**: `Readable`

Defined in: [index.ts:244](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L244)

##### stderr

> `readonly` **stderr**: `Readable`

Defined in: [index.ts:245](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L245)

#### Methods

##### wait()

> **wait**(): `Promise`\<\{ `code`: `number`; `signal`: `Signals`; \}\>

Defined in: [index.ts:248](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L248)

Resolves when the VM process exits. Rejects on timeout.

###### Returns

`Promise`\<\{ `code`: `number`; `signal`: `Signals`; \}\>

##### kill()

> **kill**(): `Promise`\<`void`\>

Defined in: [index.ts:251](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L251)

Send SIGKILL to the VM. Resolves once it's really gone.

###### Returns

`Promise`\<`void`\>

##### detach()

> **detach**(): `Promise`\<`void`\>

Defined in: [index.ts:259](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L259)

Drop this host-side handle without killing the VMM. The VM keeps
running and can be re-attached from another process. For locally-
booted handles this closes captured streams; `wait()` and
`exec()` become unreliable afterwards.

###### Returns

`Promise`\<`void`\>

##### output()

> **output**(): `Promise`\<`string`\>

Defined in: [index.ts:262](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L262)

Buffer stdout until the process exits; return it as a UTF-8 string.

###### Returns

`Promise`\<`string`\>

##### errorOutput()

> **errorOutput**(): `Promise`\<`string`\>

Defined in: [index.ts:265](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L265)

Same as `output()` but for stderr (where guest console lands).

###### Returns

`Promise`\<`string`\>

##### exec()

> **exec**(`cmd`, `opts?`): `Promise`\<[`VsockExecResult`](#vsockexecresult)\>

Defined in: [index.ts:276](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L276)

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

Defined in: [index.ts:279](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L279)

Like `exec()` but returns non-zero exit codes instead of throwing.

###### Parameters

###### cmd

`string`

###### opts?

[`VsockExecOptions`](#vsockexecoptions)

###### Returns

`Promise`\<[`VsockExecResult`](#vsockexecresult)\>

##### snapshot()

> **snapshot**(`outPath`, `opts?`): `Promise`\<[`SnapshotResult`](#snapshotresult)\>

Defined in: [index.ts:305](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L305)

Freeze this VM with CRIU and write the image to `outPath`.

The caller must have booted the VM with `snapshot: <path>` so
CRIU has a target to write to; `vm.snapshot()` copies that disk
to `outPath` once the dump completes. If boot had no disk
attached, this throws `SNAPSHOT_NO_DISK`.

Guest contract: the rootfs must ship a dump helper callable via
vsock exec — default path `/sbin/machinen-dump`, override via
`opts.dumpCmd`. The helper runs `criu dump` against the workload
tree, syncs the ext4 images it wrote to `/dev/vda`, and lets
`/sbin/machinen-supervisor` trigger PSCI SYSTEM_OFF. Success is
signalled by a clean VMM exit before `opts.timeoutMs` elapses
plus an mtime bump on the disk file — if the timer fires first,
`SNAPSHOT_TIMEOUT` is thrown; if the disk is untouched,
`SNAPSHOT_DUMP_FAILED`.

Supported on both boot-owned and attach handles — attach uses
the `diskPath` stored in the VM registry entry at boot time.

The VM exits as part of the dump. To continue using the VM
afterwards, boot a new one from the produced snapshot.

###### Parameters

###### outPath

`string`

###### opts?

[`SnapshotOptions`](#snapshotoptions)

###### Returns

`Promise`\<[`SnapshotResult`](#snapshotresult)\>

***

### SnapshotOptions

Defined in: [index.ts:308](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L308)

#### Properties

##### dumpCmd?

> `optional` **dumpCmd?**: `string`

Defined in: [index.ts:313](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L313)

Command to run in the guest to trigger the CRIU dump. Defaults to
`/sbin/machinen-dump`.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [index.ts:318](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L318)

Wall-clock ceiling for the dump + shutdown. If the VMM hasn't exited
in this window we SIGKILL it and fail. Default 90s.

##### onLog?

> `optional` **onLog?**: [`OnLog`](#onlog-3)

Defined in: [index.ts:324](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L324)

Streaming log callback — fires for every byte the dump emits
(guest console + the dump exec). See #83. When both the snapshot
call and `boot({ onLog })` have a callback set, both fire.

***

### SnapshotResult

Defined in: [index.ts:327](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L327)

#### Properties

##### snapshotPath

> **snapshotPath**: `string`

Defined in: [index.ts:329](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L329)

Absolute path to the written snapshot image.

##### elapsedMs

> **elapsedMs**: `number`

Defined in: [index.ts:331](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L331)

Time from `snapshot()` entry to VMM exit, in milliseconds.

##### consoleLog

> **consoleLog**: `string`

Defined in: [index.ts:333](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L333)

Guest console output captured during the dump.

***

### AttachOptions

Defined in: [index.ts:779](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L779)

#### Properties

##### id?

> `optional` **id?**: `string`

Defined in: [index.ts:781](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L781)

Look up a VM by its registry id. One of `id` or `name` is required.

##### name?

> `optional` **name?**: `string`

Defined in: [index.ts:783](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L783)

Look up a VM by the name passed to `boot({ name })`.

##### onLog?

> `optional` **onLog?**: [`OnLog`](#onlog-3)

Defined in: [index.ts:790](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L790)

Streaming log callback — fires for every byte of output from execs
made through the returned handle. See #83. Guest kernel console is
not available on attach handles (it belongs to the process that
called `boot()`), so only `exec-stdout` / `exec-stderr` sources fire.

***

### LogEvent

Defined in: [log.ts:14](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/log.ts#L14)

#### Properties

##### source

> **source**: `"guest-console"` \| `"exec-stdout"` \| `"exec-stderr"`

Defined in: [log.ts:21](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/log.ts#L21)

Where the chunk came from:
  - `guest-console` — kernel / PL011 console bytes (VMM stderr)
  - `exec-stdout`   — stdout of an exec invocation
  - `exec-stderr`   — stderr of an exec invocation

##### cmd?

> `optional` **cmd?**: `string`

Defined in: [log.ts:23](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/log.ts#L23)

Command string; set when `source` is `exec-stdout` or `exec-stderr`.

##### chunk

> **chunk**: `Buffer`

Defined in: [log.ts:25](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/log.ts#L25)

Raw bytes as they arrive — not line-split, not decoded.

***

### PackBundleOptions

Defined in: [mkinitramfs.ts:317](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L317)

#### Properties

##### bundle

> **bundle**: `string`

Defined in: [mkinitramfs.ts:319](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L319)

Bundle directory with rootfs/ + machinen-config.json.

##### out

> **out**: `string`

Defined in: [mkinitramfs.ts:321](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L321)

Path to the initramfs cpio to write.

##### base?

> `optional` **base?**: `string`

Defined in: [mkinitramfs.ts:323](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L323)

Optional base rootfs tarball (rootfs-debian-arm64.tar.gz).

##### mount?

> `optional` **mount?**: `object`

Defined in: [mkinitramfs.ts:330](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L330)

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

Defined in: [mkinitramfs.ts:337](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L337)

Extra env vars to merge into the bundle's machinen-config.json `env`
field before packing. The bundle's on-disk env wins on key collision
(same precedence as the mount overlay — bundle always gets the last
word). See #89.

##### excludes?

> `optional` **excludes?**: `string`[]

Defined in: [mkinitramfs.ts:339](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L339)

fnmatch patterns matched against each rootfs-relative path.

##### initPath?

> `optional` **initPath?**: `string`

Defined in: [mkinitramfs.ts:341](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L341)

Optional path to the compiled /init. Default: ../microvm/test-fixtures/init relative to this file.

***

### PackRootfsOptions

Defined in: [mkinitramfs.ts:458](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L458)

#### Properties

##### rootfs

> **rootfs**: `string`

Defined in: [mkinitramfs.ts:459](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L459)

##### out

> **out**: `string`

Defined in: [mkinitramfs.ts:460](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L460)

##### config?

> `optional` **config?**: `string`

Defined in: [mkinitramfs.ts:461](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L461)

##### excludes?

> `optional` **excludes?**: `string`[]

Defined in: [mkinitramfs.ts:462](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L462)

##### initPath?

> `optional` **initPath?**: `string`

Defined in: [mkinitramfs.ts:463](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L463)

***

### PackMinimalOptions

Defined in: [mkinitramfs.ts:480](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L480)

#### Properties

##### out

> **out**: `string`

Defined in: [mkinitramfs.ts:481](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L481)

##### initPath?

> `optional` **initPath?**: `string`

Defined in: [mkinitramfs.ts:482](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L482)

##### config?

> `optional` **config?**: `string`

Defined in: [mkinitramfs.ts:483](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L483)

***

### PackWorkspaceOptions

Defined in: [mkinitramfs.ts:501](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L501)

#### Properties

##### workspace

> **workspace**: `string`

Defined in: [mkinitramfs.ts:502](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L502)

##### out

> **out**: `string`

Defined in: [mkinitramfs.ts:503](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L503)

##### mountpoint?

> `optional` **mountpoint?**: `string`

Defined in: [mkinitramfs.ts:505](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L505)

Directory name inside the cpio (default `workspace`).

##### excludes?

> `optional` **excludes?**: `Iterable`\<`string`\>

Defined in: [mkinitramfs.ts:507](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L507)

Basename-matched excludes. Default: DEFAULT_WORKSPACE_EXCLUDES.

##### maxMb?

> `optional` **maxMb?**: `number`

Defined in: [mkinitramfs.ts:509](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L509)

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

Defined in: [multiplex.ts:140](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L140)

#### Properties

##### sandboxes

> **sandboxes**: [`Sandboxes`](#sandboxes)

Defined in: [multiplex.ts:142](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L142)

Registry to draw sandboxes from.

##### input?

> `optional` **input?**: `ReadableStream`

Defined in: [multiplex.ts:144](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L144)

Input byte stream. Defaults to `process.stdin`.

##### output?

> `optional` **output?**: `Writable`

Defined in: [multiplex.ts:146](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L146)

Output byte stream. Defaults to `process.stdout`.

##### commandPrefix?

> `optional` **commandPrefix?**: `string`

Defined in: [multiplex.ts:148](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L148)

Prefix for slash-commands. Default `/`.

##### rawTtyOnAttach?

> `optional` **rawTtyOnAttach?**: `boolean`

Defined in: [multiplex.ts:154](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L154)

Flip the terminal into raw mode while a sandbox is attached, and
restore it on detach. Enabled by default when `input` is a TTY.
Set to `false` in tests where `input` is a plain PassThrough.

##### forwardResize?

> `optional` **forwardResize?**: `boolean`

Defined in: [multiplex.ts:160](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/multiplex.ts#L160)

Forward SIGWINCH on the parent process (terminal resize) to any
attached sandbox that implements `.resize(cols, rows)`. Enabled
by default when `output` is a TTY.

***

### ProvisionOptions

Defined in: [provision.ts:47](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L47)

#### Properties

##### base?

> `optional` **base?**: `string`

Defined in: [provision.ts:57](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L57)

Path to the base rootfs tarball to start from. Typically the
`rootfs-debian-arm64.tar.gz` produced by
`scripts/build-base-assets.sh` or shipped in a machinen release.

Optional — when omitted, `provision()` resolves it via `resolveBaseRootfs()`
(MACHINEN_ASSETS_DIR env override, falling back to the `@machinen/cli`
cache at `~/.machinen/@machinen/runtime@<version>/bases/debian-arm64/`).

##### install

> **install**: (`vm`) => `Promise`\<`void`\>

Defined in: [provision.ts:62](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L62)

User-supplied provisioning steps. Runs inside the guest via vsock.

###### Parameters

###### vm

[`VmHandle`](#vmhandle)

###### Returns

`Promise`\<`void`\>

##### out

> **out**: `string`

Defined in: [provision.ts:68](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L68)

Output path for the resulting rootfs tarball. Will be overwritten.
Consumed via `boot({ image: out })`.

##### cmd?

> `optional` **cmd?**: `string`[]

Defined in: [provision.ts:76](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L76)

Default cmd baked into the image as `/machinen-config.json`.
When the image is later booted via `boot({ image })` without a
user-supplied `cmd`, the guest runs this. User-supplied `cmd` on
`boot()` still wins if provided.

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Defined in: [provision.ts:83](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L83)

Default guest env baked into the image alongside `cmd`. Merged
with `boot({ env })` at boot time, with the caller's `env`
overriding on key collision.

##### binary?

> `optional` **binary?**: `string`

Defined in: [provision.ts:89](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L89)

Optional VMM binary path. Same lookup rules as `boot()` — if
omitted, resolves `@machinen/vmm-<arch>-<os>`.

##### cwd?

> `optional` **cwd?**: `string`

Defined in: [provision.ts:92](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L92)

Working directory. Defaults to process.cwd().

##### scratchDiskSizeBytes?

> `optional` **scratchDiskSizeBytes?**: `number`

Defined in: [provision.ts:99](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L99)

Size of the scratch disk used to ferry the tarball from guest to
host. Must be larger than the expected post-install rootfs size.
Default: 1 GiB (sparse, so it doesn't actually take that space).

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [provision.ts:106](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L106)

Wall-clock ceiling for the whole build. If the install hook plus
the final archive + shutdown doesn't finish in this window, we
SIGKILL the VMM and fail. Default: 10 minutes.

##### vmmEnv?

> `optional` **vmmEnv?**: `Record`\<`string`, `string`\>

Defined in: [provision.ts:113](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L113)

Extra env passed to the VMM process on the host side. Useful for
dev overrides like `MACHINEN_BOOT_TEST`. Distinct from `env`,
which bakes guest-workload env into the produced image.

##### kernel?

> `optional` **kernel?**: `string`

Defined in: [provision.ts:116](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L116)

Path to the guest kernel. Same semantics as `boot({ kernel })`.

##### dtb?

> `optional` **dtb?**: `string`

Defined in: [provision.ts:119](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L119)

Path to the guest DTB. Same semantics as `boot({ dtb })`.

##### onLog?

> `optional` **onLog?**: [`OnLog`](#onlog-3)

Defined in: [provision.ts:127](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L127)

Streaming log callback — fires for every byte of guest output
during the build: guest kernel console, every `vm.exec()` call
the install hook makes, and the internal tar / poweroff execs.
See `LogEvent.source` to tell them apart. See #83.

***

### ProvisionResult

Defined in: [provision.ts:130](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L130)

#### Properties

##### imagePath

> **imagePath**: `string`

Defined in: [provision.ts:132](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L132)

Absolute path to the output tarball.

##### sizeBytes

> **sizeBytes**: `number`

Defined in: [provision.ts:135](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L135)

Size of the output tarball in bytes.

##### elapsedMs

> **elapsedMs**: `number`

Defined in: [provision.ts:138](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L138)

Wall-clock time from build() entry to return.

***

### PtyBootOptions

Defined in: [pty.ts:89](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L89)

#### Properties

##### binary

> **binary**: `string`

Defined in: [pty.ts:91](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L91)

Absolute or cwd-relative path to the binary to fork.

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Defined in: [pty.ts:93](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L93)

Extra env. Merged over process.env.

##### cwd?

> `optional` **cwd?**: `string`

Defined in: [pty.ts:94](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L94)

##### args?

> `optional` **args?**: `string`[]

Defined in: [pty.ts:95](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L95)

##### cols?

> `optional` **cols?**: `number`

Defined in: [pty.ts:97](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L97)

Initial terminal size. Defaults to 80x24.

##### rows?

> `optional` **rows?**: `number`

Defined in: [pty.ts:98](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L98)

##### name?

> `optional` **name?**: `string`

Defined in: [pty.ts:100](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L100)

TERM value. Default `xterm-256color` — the CC banner wants colors.

***

### PtyVmHandle

Defined in: [pty.ts:103](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L103)

#### Properties

##### pid

> `readonly` **pid**: `number`

Defined in: [pty.ts:104](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L104)

##### stdin

> `readonly` **stdin**: `Writable`

Defined in: [pty.ts:105](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L105)

##### stdout

> `readonly` **stdout**: `Readable`

Defined in: [pty.ts:106](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L106)

##### stderr

> `readonly` **stderr**: `Readable`

Defined in: [pty.ts:108](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L108)

Same stream as `stdout`. A pty merges stdout + stderr in the kernel.

#### Methods

##### resize()

> **resize**(`cols`, `rows`): `void`

Defined in: [pty.ts:110](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L110)

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

Defined in: [pty.ts:111](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L111)

###### Returns

`Promise`\<\{ `code`: `number`; `signal`: `Signals`; \}\>

##### kill()

> **kill**(): `Promise`\<`void`\>

Defined in: [pty.ts:112](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L112)

###### Returns

`Promise`\<`void`\>

##### output()

> **output**(): `Promise`\<`string`\>

Defined in: [pty.ts:113](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L113)

###### Returns

`Promise`\<`string`\>

##### errorOutput()

> **errorOutput**(): `Promise`\<`string`\>

Defined in: [pty.ts:115](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L115)

Alias of output() — a pty gives us one merged stream.

###### Returns

`Promise`\<`string`\>

***

### RegistryEntry

Defined in: [registry.ts:24](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L24)

#### Properties

##### id

> **id**: `string`

Defined in: [registry.ts:26](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L26)

Auto-generated short id. Unique per VM.

##### name?

> `optional` **name?**: `string`

Defined in: [registry.ts:28](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L28)

Optional human-friendly name (from `boot({ name })`).

##### pid

> **pid**: `number`

Defined in: [registry.ts:30](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L30)

PID of the VMM process on this host.

##### socketPath

> **socketPath**: `string`

Defined in: [registry.ts:32](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L32)

Host-side vsock UDS the exec-agent is reachable on.

##### imagePath?

> `optional` **imagePath?**: `string`

Defined in: [registry.ts:34](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L34)

Path to the image the VM was booted from (diagnostic only).

##### diskPath?

> `optional` **diskPath?**: `string`

Defined in: [registry.ts:42](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L42)

Host-side path of the disk file attached as /dev/vda (from
`boot({ snapshot: <path> })`). Required for `attach().snapshot()`
so the attached handle knows which file to copy to the caller's
outPath after the guest dump completes. Undefined for VMs booted
without a disk.

##### startedAt

> **startedAt**: `number`

Defined in: [registry.ts:44](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L44)

ms epoch when the entry was created.

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

### OnLog

> **OnLog** = (`evt`) => `void`

Defined in: [log.ts:28](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/log.ts#L28)

#### Parameters

##### evt

[`LogEvent`](#logevent)

#### Returns

`void`

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

##### BOOT\_PACK\_FAILED

> `readonly` **BOOT\_PACK\_FAILED**: `"BOOT_PACK_FAILED"` = `"BOOT_PACK_FAILED"`

##### BOOT\_TIMEOUT

> `readonly` **BOOT\_TIMEOUT**: `"BOOT_TIMEOUT"` = `"BOOT_TIMEOUT"`

##### EXEC\_VSOCK\_UNAVAILABLE

> `readonly` **EXEC\_VSOCK\_UNAVAILABLE**: `"EXEC_VSOCK_UNAVAILABLE"` = `"EXEC_VSOCK_UNAVAILABLE"`

##### EXEC\_AGENT\_UNAVAILABLE

> `readonly` **EXEC\_AGENT\_UNAVAILABLE**: `"EXEC_AGENT_UNAVAILABLE"` = `"EXEC_AGENT_UNAVAILABLE"`

##### EXEC\_AGENT\_TIMEOUT

> `readonly` **EXEC\_AGENT\_TIMEOUT**: `"EXEC_AGENT_TIMEOUT"` = `"EXEC_AGENT_TIMEOUT"`

##### EXEC\_CMD\_INVALID

> `readonly` **EXEC\_CMD\_INVALID**: `"EXEC_CMD_INVALID"` = `"EXEC_CMD_INVALID"`

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

##### PROVISION\_BASE\_NOT\_FOUND

> `readonly` **PROVISION\_BASE\_NOT\_FOUND**: `"PROVISION_BASE_NOT_FOUND"` = `"PROVISION_BASE_NOT_FOUND"`

##### PROVISION\_ASSETS\_DIR\_INVALID

> `readonly` **PROVISION\_ASSETS\_DIR\_INVALID**: `"PROVISION_ASSETS_DIR_INVALID"` = `"PROVISION_ASSETS_DIR_INVALID"`

##### PROVISION\_INSTALL\_HOOK\_FAILED

> `readonly` **PROVISION\_INSTALL\_HOOK\_FAILED**: `"PROVISION_INSTALL_HOOK_FAILED"` = `"PROVISION_INSTALL_HOOK_FAILED"`

##### PROVISION\_DISK\_TOO\_SMALL

> `readonly` **PROVISION\_DISK\_TOO\_SMALL**: `"PROVISION_DISK_TOO_SMALL"` = `"PROVISION_DISK_TOO_SMALL"`

##### REGISTRY\_VM\_NOT\_FOUND

> `readonly` **REGISTRY\_VM\_NOT\_FOUND**: `"REGISTRY_VM_NOT_FOUND"` = `"REGISTRY_VM_NOT_FOUND"`

##### FILES\_HOST\_DIR\_NOT\_FOUND

> `readonly` **FILES\_HOST\_DIR\_NOT\_FOUND**: `"FILES_HOST_DIR_NOT_FOUND"` = `"FILES_HOST_DIR_NOT_FOUND"`

##### FILES\_AGENT\_UNAVAILABLE

> `readonly` **FILES\_AGENT\_UNAVAILABLE**: `"FILES_AGENT_UNAVAILABLE"` = `"FILES_AGENT_UNAVAILABLE"`

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

Defined in: [exec.ts:46](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/exec.ts#L46)

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

EXEC_CMD_INVALID | EXEC_AGENT_UNAVAILABLE (retryable) |
  EXEC_AGENT_TIMEOUT (retryable) | EXEC_PROTOCOL

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

## Functions

### resolveCacheDir()

> **resolveCacheDir**(`opts?`): `string`

Defined in: [artifact-cache.ts:57](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/artifact-cache.ts#L57)

Resolve the cache root using env override → default. Pulled out so
tests and callers that need to inspect the path agree with what
spawnArtifactCache() will pick.

#### Parameters

##### opts?

[`ArtifactCacheOptions`](#artifactcacheoptions) = `{}`

#### Returns

`string`

***

### spawnArtifactCache()

> **spawnArtifactCache**(`opts?`): `Promise`\<[`ArtifactCacheHandle`](#artifactcachehandle)\>

Defined in: [artifact-cache.ts:72](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/artifact-cache.ts#L72)

Start the host-side artifact cache on an ephemeral loopback port.
The returned handle stays valid until `stop()` is called.

#### Parameters

##### opts?

[`ArtifactCacheOptions`](#artifactcacheoptions) = `{}`

#### Returns

`Promise`\<[`ArtifactCacheHandle`](#artifactcachehandle)\>

***

### isMachinenError()

> **isMachinenError**(`err`, `code?`): `err is MachinenError`

Defined in: [errors.ts:150](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L150)

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

Defined in: [errors.ts:159](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/errors.ts#L159)

Format a MachinenError for CLI stderr. Shows the code inline and walks
the `cause` chain. Used by the CLI's unified `handleError`; exported so
library callers can adopt the same format if they want to.

#### Parameters

##### err

[`MachinenError`](#machinenerror)

#### Returns

`string`

***

### resolveVmmBinary()

> **resolveVmmBinary**(): `string`

Defined in: [index.ts:119](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L119)

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

Defined in: [index.ts:347](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L347)

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
  BOOT_PORT_FORWARD_NO_GVPROXY | BOOT_PACK_FAILED

***

### attach()

> **attach**(`opts`): `Promise`\<[`VmHandle`](#vmhandle)\>

Defined in: [index.ts:806](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L806)

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

### measureFirstByte()

> **measureFirstByte**(`vm`): `Promise`\<`number`\>

Defined in: [index.ts:1291](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/index.ts#L1291)

Time-to-first-output-byte for a boot. Useful for measuring how
much the snapshot path is (or isn't) buying us.

#### Parameters

##### vm

[`VmHandle`](#vmhandle)

#### Returns

`Promise`\<`number`\>

***

### mkinitramfsBundle()

> **mkinitramfsBundle**(`opts`): `void`

Defined in: [mkinitramfs.ts:344](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L344)

#### Parameters

##### opts

[`PackBundleOptions`](#packbundleoptions)

#### Returns

`void`

***

### mkinitramfsRootfs()

> **mkinitramfsRootfs**(`opts`): `void`

Defined in: [mkinitramfs.ts:466](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L466)

#### Parameters

##### opts

[`PackRootfsOptions`](#packrootfsoptions)

#### Returns

`void`

***

### mkinitramfsMinimal()

> **mkinitramfsMinimal**(`opts`): `void`

Defined in: [mkinitramfs.ts:486](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L486)

#### Parameters

##### opts

[`PackMinimalOptions`](#packminimaloptions)

#### Returns

`void`

***

### mkinitramfsWorkspace()

> **mkinitramfsWorkspace**(`opts`): `void`

Defined in: [mkinitramfs.ts:512](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L512)

#### Parameters

##### opts

[`PackWorkspaceOptions`](#packworkspaceoptions)

#### Returns

`void`

***

### mkinitramfsCli()

> **mkinitramfsCli**(`argv`): `void`

Defined in: [mkinitramfs.ts:599](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/mkinitramfs.ts#L599)

Invoked by the CLI shim at packages/microvm/test-fixtures/assets/mkinitramfs.ts.
Kept argv-compatible with the old Python script so shell fixtures
(smoke.sh, try.sh, handoff.sh) don't need deeper changes.

#### Parameters

##### argv

`string`[]

#### Returns

`void`

***

### resolveBaseRootfs()

> **resolveBaseRootfs**(`explicit?`, `cwd?`): `string`

Defined in: [provision.ts:186](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L186)

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

Defined in: [provision.ts:245](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/provision.ts#L245)

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

Defined in: [pty.ts:123](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/pty.ts#L123)

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

Defined in: [registry.ts:53](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L53)

Absolute path to the registry root. Honors `MACHINEN_REGISTRY_DIR`
so tests can point at a scratch dir without stomping on real entries.

#### Returns

`string`

***

### list()

> **list**(): [`RegistryEntry`](#registryentry)[]

Defined in: [registry.ts:118](https://github.com/redwoodjs/machinen/blob/main/packages/runtime/src/registry.ts#L118)

List all registry entries whose pid is still alive. Prunes stale
entries (pid no longer alive) as a side effect, so a crashed VMM
doesn't leave a stuck record behind.

#### Returns

[`RegistryEntry`](#registryentry)[]

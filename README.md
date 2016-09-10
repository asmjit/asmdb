AsmDB
-----

This is a public domain database of a complete X86/X64 instruction set, from legacy instruction sets to the newest AVX-512.

The file `x64data.js` contains the X86 DATA in a JSON-like format and file `x64util.js` provides utilities to index such data and make it more friendly for additional processing.

AsmDB provides the following information about each X86/X64 instruction:

  * Instruction name
  * Instruction operand(s):
    * Specifies always all possible operands for the given encoding & opcode
    * Operands can optionally contains a read/write information:
      * `R:` - The operand is read
      * `W:` - The operand is written
      * `X:` - The operand is read & written
      * `W[A:B]:` - Like `W:`, but specifies the first byte that is written (`A`) and how many bytes are written (`B`)
      * `<...>` - The operand (in most cases a register) is implicit and can be omitted
    * AVX-512 options:
      * `{k}` - Instruction supports write-masking
      * `{kz}` - Instruction supports write-masking by zeroing
      * `{er}` - Instruction supports embedded rounding control
      * `{sae}` - Instruction supports `suppress-all-exceptions` feature
  * Instruction encoding and opcode as specified in X86/X64 instruction-set manuals
  * Additional information that specifies:
    * Architecture required to encode / execute the instruction (ANY, X86, X64)
    * Extension(s) required to execute the instruction (MMX, SSE2, AVX2, ...)
    * Flags read/written by the instruction (CF, ZF, ... - R=Read, W=Written X=RW)
    * Prefixes that can be used before the instruction:
      * LOCK - Lock prefix can be used
      * REP - Rep prefix can be used
    * FPU (x87) flags:
      * FPU - The instruction is a FPU (x87) instruction
      * FPU_PUSH - The instruction pushes a value onto the FPU stack
      * FPU_POP - The instruction pops a value from the FPU stack
      * FPU_POP=2 - The instruction pops two values from the FPU stack
      * FPU_TOP=[+-]N - The instruction changes the top pointer of the FPU stack
    * Volatility - a hint for instruction reordering and scheduling
      * VOLATILE - The instruction must not be reordered
    * Privilege level:
      * PRIVILEGE=L[0-3] - The instruction's privilege level

The `x86util.js` is designed to index everything that the database provides and to present it in a much more structured form. It's a recommended tool for a post-processing.

Usage Guide
-----------

The following snippet shows a basic usage of a `x86util.X86DataBase()`:

```js
// This creates an `X86DataBase` instance populated with the data provided by `x86data.js`.
const asmdb = require("asmdb");
const x86db = new asmdb.x86util.X86DataBase().addDefault();

// Returns an array of instruction names stored in the database:
console.log(x86db.getInstructionNames());

// Iterates over all instructions in the database. Please note that instructions
// that have different operands but the same name will appear multiple times as
// specified in the X86/X64 manuals. The `inst` is an `x86util.X86Instruction`
// instance.
x86db.forEach(function(inst) {
  console.log(`Instruction '{inst.name}' [${inst.encoding}] ${inst.opcodeString}`);
}, this);

// Iterates over all instructions in the database, but groups instructions having
// the same name. It's similar to `forEach()`, but instead of providing a single
// instruction each time it provides an array of instructions sharing the same
// name.
x86db.forEachGroup(function(name, insts) {
  console.log(`Instruction ${name}`:);
  for (var i = 0; i < insts.length; i++) {
    const inst = insts[i];
    console.log(`  [${inst.encoding}] ${inst.opcodeString}`);
  }
}, this);

// If iterators are not what you want, it's possible to get a list of instructions
// of the same name by using `getGroup()`.
var insts = x86db.getGroup("mov");
console.log("Instruction 'mov':")
for (var i = 0; i < insts.length; i++) {
  const inst = insts[i];
  console.log(`  [${inst.encoding}] ${inst.opcodeString}`);
}

// You can implement your own iterator by using getInstructionNames() and getGroup():
const names = x86db.getInstructionNames();
for (var i = 0; i < names.length; i++) {
  const name = names[i];
  const insts = x86.getGroup(name);
  // ...
}
```

The snippet above just shown how to get instructions and list basic properties. What is more interesting is accessing `x86util.X86Instruction` and `x86util.X86Operand` data.

```js
const asmdb = require("asmdb");
const x86db = new asmdb.x86util.X86DataBase().addDefault();

// Get some instruction (the first in the group):
const inst = x86db.getGroup("vpunpckhbw")[0];
console.log(JSON.stringify(inst, null, 2));

// Iterate over its operands:
const operands = inst.operands;
for (var i = 0; i < operands.length; i++) {
  const operand = operands[i];
  // ...
}
```

The stringified instruction would print something like this (with added comments that describe the meaning of individual properties):

```js
{
  "name": "vpunpckhbw",            // Instruction name.
  "arch": "ANY",                   // Architecture - ANY, X86, X64.
  "encoding": "RVM",               // Instruction encoding.
  "prefix": "VEX",                 // Prefix - "", "3DNOW", "EVEX", "VEX", "XOP".
  "opcode": "68",                  // A single opcode byte as a hex string, "00-FF".
  "opcodeInt": 104,                // OA single opcode byte as an integer (0..255).
  "opcodeString":                  // The whole opcode string, as specified in manual.
    "VEX.NDS.128.66.0F.WIG 68 /r",
  "l": "128",                      // Opcode L field (nothing, 128, 256, 512).
  "w": "WIG",                      // Opcode W field.
  "pp": "66",                      // Opcode PP part.
  "mm": "0F",                      // Opcode MM[MMM] part.
  "vvvv": "NDS",                   // Opcode VVVV part.
  "_67h": false,                   // Instruction requires a size override prefix.
  "rm": "r",                       // Instruction specific payload "/0..7".
  "rmInt": -1,                     // Instruction specific payload as integer (0-7).
  "ri": false,                     // Instruction opcode is combined with register, "XX+r" or "XX+i".
  "rel": 0,                        // Displacement (cb cw cd parts).
  "implicit": false,               // Uses implicit operands (registers / memory).
  "lock": false,                   // Can be used with LOCK prefix.
  "rep": false,                    // Can be used with REP prefix.
  "repz": false,                   // Can be used with REPE/REPZ prefix.
  "repnz": false,                  // Can be used with REPNE/REPNZ prefix.
  "xcr": "",                       // Reads or writes to/from XCR register.
  "volatile": false,               // Volatile instruction hint for the instruction scheduler.
  "privilege": 3,                  // Privilege level required to execute the instruction.
  "fpu": false,                    // True if this is an FPU instruction.
  "mmx": false,                    // True if this is an MMX instruction.
  "fpuTop": 0,                     // FPU top index manipulation [-1, 0, 1, 2].
  "vsibReg": "",                   // AVX VSIB register type (xmm/ymm/zmm).
  "vsibSize": -1,                  // AVX VSIB register size (32/64).
  "broadcast": false,              // AVX-512 broadcast support.
  "bcstSize": -1,                  // AVX-512 broadcast size.
  "kmask": false,                  // AVX-512 merging {k}.
  "zmask": false,                  // AVX-512 zeroing {kz}, implies {k}.
  "sae": false,                    // AVX-512 suppress all exceptions {sae} support.
  "rnd": false,                    // AVX-512 embedded rounding {er}, implies {sae}.
  "tupleType": "",                 // AVX-512 tuple-type.
  "elementSize": -1,               // Instruction element size (used by broadcast).
  "invalid": 0,                    // Number of problems detected by X86DataBase.

  // CPU flags required to execute the instruction:
  "cpu": {
    "AVX": true                    // Instruction is an "AVX" instruction.
  },

  // EFLAGS used/modified by the instruction.
  "eflags": {
  },

  // Instruction operands:
  "operands": [{
    "data": "xmm",                 // The operand's data (processed).
    "reg": "xmm",                  // Register operand's definition.
    "regType": "xmm",              // Register operand's type (would differ if reg is "eax" for example).
    "mem": "",                     // Memory operand's definition.
    "memSize": -1,                 // Memory operand's size.
    "memOff": false,               // Memory operand is an absolute offset (only a specific version of MOV).
    "memSeg": "",                  // Segment specified with register that is used to perform a memory IO.
    "vsibReg": "",                 // AVX VSIB register type (xmm/ymm/zmm).
    "vsibSize": -1,                // AVX VSIB register size (32/64).
    "bcstSize": -1,                // AVX-512 broadcast size.
    "imm": 0,                      // Immediate operand's size.
    "immValue": null,              // Immediate value - `null` or `1` (only used by shift/rotate instructions).
    "rel": 0,                      // Relative displacement operand's size.
    "implicit": false,             // True if the operand is an implicit register (not encoded in binary).
    "read": false,                 // True if the operand is a read-op (R or X) from reg/mem.
    "write": true,                 // True if the operand is a write-op (W or X) to reg/mem.
    "rwxIndex": null,              // Read/Write (RWX) index.
    "rwxWidth": null               // Read/Write (RWX) width.
  }, {
    "data": "xmm",                 // ...
    "reg": "xmm",
    "regType": "xmm",
    "mem": "",
    "memSize": -1,
    "memOff": false,
    "memSeg": "",
    "vsibReg": "",
    "vsibSize": -1,
    "bcstSize": -1,
    "imm": 0,
    "immValue": null,
    "rel": 0,
    "implicit": false,
    "read": true,
    "write": false,
    "rwxIndex": -1,
    "rwxWidth": -1
  }, {
    "data": "xmm/m128",
    "reg": "xmm",
    "regType": "xmm",
    "mem": "m128",
    "memSize": 128,
    "memOff": false,
    "memSeg": "",
    "vsibReg": "",
    "vsibSize": -1,
    "bcstSize": -1,
    "imm": 0,
    "immValue": null,
    "rel": 0,
    "implicit": false,
    "read": true,
    "write": false,
    "rwxIndex": -1,
    "rwxWidth": -1
  }]
}
```


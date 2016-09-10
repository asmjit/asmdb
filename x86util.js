// [x86util.js]
// X86/X64 instruction-set utilities that use `x86data.js`.

(function($export, $as) {
"use strict";

const x86data = $export.x86data ? $export.x86data : require("./x86data.js");
const hasOwn = Object.prototype.hasOwnProperty;

// Creates an Object without a prototype (used as a map).
function dict() { return Object.create(null); }

function mapFromArray(arr) {
  const map = dict();
  for (var i = 0; i < arr.length; i++)
    map[arr[i]] = true;
  return map;
}

// Build an object containing CPU registers as keys mapping them to type, kind, and index.
function buildCpuRegs(defs) {
  const map = dict();

  for (var type in defs) {
    const def = defs[type];
    const kind = def.kind;
    const names = def.names;

    if (def.any)
      map[def.any] = { type: type, kind: kind, index: -1 };

    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var m = /^([\w\(\)]+)(\d+)-(\d+)([\w\(\)]*)$/.exec(name);

      if (m) {
        var a = parseInt(m[2], 10);
        var b = parseInt(m[3], 10);

        for (var n = a; n <= b; n++) {
          const index = m[1] + n + m[4];
          map[index] = { type: type, kind: kind, index: index };
        }
      }
      else {
        map[name] = { type: type, kind: kind, index: i };
      }
    }
  }

  return map;
}

// ============================================================================
// [Constants]
// ============================================================================

// Indexes used by x86-data.
const kIndexName       = 0;
const kIndexOperands   = 1;
const kIndexEncoding   = 2;
const kIndexOpcode     = 3;
const kIndexFlags      = 4;

const kCpuArchitecture = mapFromArray(x86data.architectures);
const kCpuFeatures     = mapFromArray(x86data.features);
const kCpuRegisters    = buildCpuRegs(x86data.registers);

const kCpuFlags = {
  "OF": true, // Overflow flag.
  "SF": true, // Sign flag.
  "ZF": true, // Zero flag.
  "AF": true, // Adjust flag.
  "PF": true, // Parity flag.
  "CF": true, // Carry flag.
  "DF": true, // Direction flag.
  "IF": true, // Interrupt flag.
  "AC": true, // Alignment check.
  "C0": true, // FPU's C0 flag.
  "C1": true, // FPU's C1 flag.
  "C2": true, // FPU's C2 flag.
  "C3": true  // FPU's C3 flag.
};

// ============================================================================
// [misc]
// ============================================================================

// Miscellaneous functions.
class misc {
  // Get whether the string `s` describes a register operand.
  static isRegOp(s) { return s && hasOwn.call(kCpuRegisters, s); }
  // Get whether the string `s` describes a memory operand.
  static isMemOp(s) { return s && /^(?:mem|mib|(?:m(?:off)?\d+(?:dec|bcd|fp|int)?)|(?:vm\d+(?:x|y|z)))$/.test(s); }
  // Get whether the string `s` describes an immediate operand.
  static isImmOp(s) { return s && /^(?:1|i4|ib|iw|id|iq)$/.test(s); }
  // Get whether the string `s` describes a relative displacement (label).
  static isRelOp(s) { return s && /^rel\d+$/.test(s); }

  // Get a register type of a `s`, returns `null` if the register is unknown.
  static regTypeOf(s) { return hasOwn.call(kCpuRegisters, s) ? kCpuRegisters[s].type : null; }
  // Get a register kind of a `s`, returns `null` if the register is unknown.
  static regKindOf(s) { return hasOwn.call(kCpuRegisters, s) ? kCpuRegisters[s].kind : null; }
  // Get a register type of a `s`, returns `null` if the register is unknown and `-1`
  // if the given string does only represent a register type, but not a specific reg.
  static regIndexOf(s) { return hasOwn.call(kCpuRegisters, s) ? kCpuRegisters[s].index : null; }

  // Get size in bytes of an immediate `s`.
  //
  // Handles "ib", "iw", "id", "iq", and also "/is4".
  static immSize(s) {
    if (s === "1" ) return 8;
    if (s === "i4" || s === "/is4") return 4;
    if (s === "ib") return 8;
    if (s === "iw") return 16;
    if (s === "id") return 32;
    if (s === "iq") return 64;

    return -1;
  }

  // Get size in bytes of a relative displacement.
  //
  // Handles "rel8" and "rel32".
  static relSize(s) {
    if (s === "rel8") return 8;
    if (s === "rel32") return 32;

    return -1;
  }
}
exports.misc = misc;

// ============================================================================
// [X86Operand]
// ============================================================================

// X86/X64 operand
class X86Operand {
  constructor(data, defaultAccess) {
    this.data = data;       // The operand's data (processed).

    this.reg = "";          // Register operand's definition.
    this.regType = "";      // Register operand's type.

    this.mem = "";          // Memory operand's definition.
    this.memSize = -1;      // Memory operand's size.
    this.memOff = false;    // Memory operand is an absolute offset (only a specific version of MOV).
    this.memSeg = "";       // Segment specified with register that is used to perform a memory IO.
    this.vsibReg = "";      // AVX VSIB register type (xmm/ymm/zmm).
    this.vsibSize = -1;     // AVX VSIB register size (32/64).
    this.bcstSize = -1;     // AVX-512 broadcast size.

    this.imm = 0;           // Immediate operand's size.
    this.immValue = null;   // Immediate value - `null` or `1` (only used by shift/rotate instructions).
    this.rel = 0;           // Relative displacement operand's size.

    this.read = false;      // True if the operand is a read-op (R or X) from reg/mem.
    this.write = false;     // True if the operand is a write-op (W or X) to reg/mem.
    this.rwxIndex = -1;     // Read/Write (RWX) index.
    this.rwxWidth = -1;     // Read/Write (RWX) width.
    this.implicit = false;  // True if the operand is an implicit register (not encoded in binary).

    // Handle RWX decorators prefix in "R|W|X[A:B]:" format.
    var m = /^(R|W|X)(\[(\d+)\:(\d+)\])?\:/.exec(data);
    if (m) {
      // RWX:
      this.setAccess(m[1]);

      // RWX[A:B]:
      if (m.length > 2) {
        var a = parseInt(m[2], 10);
        var b = parseInt(m[3], 10);

        this.rwxIndex = Math.min(a, b);
        this.rwxWidth = Math.abs(a - b) + 1;
      }

      // Remove RWX information from the operand's string.
      data = data.substr(m[0].length);
    }
    else {
      this.setAccess(defaultAccess);
    }

    // Handle AVX-512 broadcast possibility specified as "/bN" suffix.
    m = /\/b(\d+)/.exec(data);
    if (m) {
      this.bcstSize = parseInt(m[1], 10);

      // Remove broadcast from the operand's definition; it's not needed anymore.
      data = data.substr(0, m.index) + data.substr(m.index + m[0].length);
    }

    // Handle an implicit operand.
    if (data.charAt(0) === "<" && data.charAt(data.length - 1) === ">") {
      this.implicit = true;

      // Remove "<...>" from the operand's definition.
      data = data.substring(1, data.length - 1);
    }

    // In case the data has been modified it's always better to use the stripped off
    // version as we have already processed and stored all the possible decorators.
    this.data = data;

    // Support multiple operands separated by "/" (only used by r/m style definition).
    var ops = data.split("/");
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i].trim();

      // Handle a segment specification if this is an implicit register performing
      // memory access.
      if (/^(?:ds|es)\:/.test(op)) {
        this.memSeg = op.substr(0, 2);
        op = op.substr(3);
      }

      if (misc.isRegOp(op)) {
        this.reg = op;
        this.regType = misc.regTypeOf(op);

        continue;
      }

      if (misc.isMemOp(op)) {
        this.mem = op;

        // Handle memory size.
        m = /^m(?:off)?(\d+)/.exec(op);
        this.memSize = m ? parseInt(m[1], 10) : 0;
        this.memOff = op.indexOf("moff") === 0;

        // Handle vector addressing mode and size "vmXXr".
        m = /^vm(\d+)(x|y|z)$/.exec(op);
        if (m) {
          this.vsibReg = m[2] + "mm";
          this.vsibSize = parseInt(m[1], 10);
        }

        continue;
      }

      if (misc.isImmOp(op)) {
        this.imm = misc.immSize(op);
        if (op === "1") {
          this.implicit = true;
          this.immValue = 1;
        }
        continue;
      }

      if (misc.isRelOp(op)) {
        this.rel = misc.relSize(op);
        continue;
      }

      console.log(`Unhandled operand: '${op}'`);
    }
  }

  setAccess(access) {
    this.read  = access === "R" || access === "X";
    this.write = access === "W" || access === "X";
    return this;
  }

  isReg() { return !!this.reg; }
  isMem() { return !!this.mem; }
  isImm() { return !!this.imm; }
  isRel() { return !!this.rel; }

  isRegAndMem() { return !!this.reg && !!this.mem; }
  isRegOrMem() { return !!this.reg || !!this.mem; }

  toRegMem() {
    if (this.reg && this.mem)
      return this.reg + "/m";
    else if (this.mem && (this.vsibReg || /fp$|int$/.test(this.mem)))
      return this.mem;
    else if (this.mem)
      return "m";
    else
      return this.toString();
  }

  toString() { return this.data; }
}
exports.X86Operand = X86Operand;

// ============================================================================
// [X86Instruction]
// ============================================================================

// X86/X64 instruction.
class X86Instruction {
  constructor(name, operands, encoding, opcode, flags) {
    this.name = name;       // Instruction name.
    this.arch = "ANY";      // Architecture - ANY, X86, X64.
    this.encoding = "";     // Instruction encoding.

    this.prefix = "";       // Prefix - "", "3DNOW", "EVEX", "VEX", "XOP".

    this.opcode = "";       // A single opcode byte as a hex string, "00-FF".
    this.opcodeInt = 0;     // A single opcode byte as an integer (0..255).
    this.opcodeString = ""; // The whole opcode string, as specified in manual.

    this.l = "";            // Opcode L field (nothing, 128, 256, 512).
    this.w = "";            // Opcode W field.
    this.pp = "";           // Opcode PP part.
    this.mm = "";           // Opcode MM[MMM] part.
    this.vvvv = "";         // Opcode VVVV part.
    this._67h = false;      // Instruction requires a size override prefix.

    this.rm = "";           // Instruction specific payload "/0..7".
    this.rmInt = -1;        // Instruction specific payload as integer (0-7).
    this.ri = false;        // Instruction opcode is combined with register, "XX+r" or "XX+i".
    this.rel = 0;           // Displacement (cb cw cd parts).

    this.implicit = false;  // Uses implicit operands (registers / memory).
    this.lock = false;      // Can be used with LOCK prefix.
    this.rep = false;       // Can be used with REP prefix.
    this.repz = false;      // Can be used with REPE/REPZ prefix.
    this.repnz = false;     // Can be used with REPNE/REPNZ prefix.
    this.xcr = "";          // Reads or writes to/from XCR register.

    this.volatile = false;  // Volatile instruction hint for the instruction scheduler.
    this.privilege = 3;     // Privilege level required to execute the instruction.

    this.fpuTop = 0;        // FPU top index manipulation [-1, 0, 1, 2].
    this.fpu = false;       // If the instruction is an FPU instruction.
    this.mmx = false;       // If the instruction is an MMX instruction.

    this.vsibReg = "";      // AVX VSIB register type (xmm/ymm/zmm).
    this.vsibSize = -1;     // AVX VSIB register size (32/64).

    this.broadcast = false; // AVX-512 broadcast support.
    this.bcstSize = -1;     // AVX-512 broadcast size.

    this.kmask = false;     // AVX-512 merging {k}.
    this.zmask = false;     // AVX-512 zeroing {kz}, implies {k}.
    this.sae = false;       // AVX-512 suppress all exceptions {sae} support.
    this.rnd = false;       // AVX-512 embedded rounding {er}, implies {sae}.

    this.tupleType = "";    // AVX-512 tuple-type.
    this.elementSize = -1;  // Instruction's element size.
    this.invalid = 0;       // Number of problems detected by X86DataBase.
    this.cpu = dict();      // CPU features required to execute the instruction.
    this.eflags = dict();   // CPU flags read/written/zeroed/set/undefined.
    this.operands = [];     // Instruction operands array.

    this.assignOperands(operands);
    this.assignEncoding(encoding);

    this.assignOpcode(opcode);
    this.assignFlags(flags);
  }

  isAVX() { return this.isVEX() || this.isEVEX(); }
  isVEX() { return this.prefix === "VEX" || this.prefix === "XOP"; }
  isEVEX() { return this.prefix === "EVEX" }

  getWValue() {
    switch (this.w) {
      case "W0": return 0;
      case "W1": return 1;
    }
    return -1;
  }

  // Get signature of the instruction in an "ARCH PREFIX ENCODING[:operands]" form.
  getSignature() {
    var operands = this.operands;
    var sign = this.arch;

    if (this.prefix) {
      sign += " " + this.prefix;
      if (this.prefix !== "3DNOW") {
        if (this.l === "L1")
          sign += ".256";
        else if (this.l === "256" || this.l === "512")
          sign += `.${this.l}`;
        else
          sign += ".128";

        if (this.w === "W1")
          sign += ".W";
      }
    }
    else if (this.w === "W1") {
      sign += " REX.W";
    }

    sign += " " + this.encoding;

    for (var i = 0; i < operands.length; i++) {
      sign += (i === 0) ? ":" : ",";

      var operand = operands[i];
      if (operand.implicit)
        sign += `[${operand.reg}]`;
      else
        sign += operand.toRegMem();
    }

    return sign;
  }

  getImmCount() {
    var ops = this.operands;
    var n = 0;

    for (var i = 0; i < ops.length; i++) {
      if (ops[i] === "imm")
        n++;
    }

    return n;
  }

  assignOperands(s) {
    if (!s)
      return;

    // First remove all flags specified as {...}. We put them into `flags`
    // map and mix with others. This seems to be the best we can do here.
    for (;;) {
      var a = s.indexOf("{");
      var b = s.indexOf("}");

      if (a === -1 || b === -1)
        break;

      // Get the `flag` and remove from `s`.
      this.assignFlag(s.substring(a + 1, b), true);
      s = s.substr(0, a) + s.substr(b + 1);
    }

    // Split into individual operands and push them to `operands`.
    var parts = s.split(",");
    for (var i = 0; i < parts.length; i++) {
      var data = parts[i].trim();
      var operand = new X86Operand(data, i === 0 ? "X" : "R");

      // Propagate broadcast.
      if (operand.bcstSize > 0)
        this.assignFlag("broadcast", operand.bcstSize);

      // Propagate implicit operand.
      if (operand.implicit)
        this.implicit = true;

      // Propagate VSIB.
      if (operand.vsibReg) {
        if (this.vsibReg) {
          this.report("Only one operand can be a vector memory address (vmNNx)");
        }

        this.vsibReg = operand.vsibReg;
        this.vsibSize = operand.vsibSize;
      }

      this.operands.push(operand);
    }
  }

  assignEncoding(s) {
    // Parse 'TUPLE-TYPE' as defined by AVX-512.
    var i = s.indexOf("-");
    if (i !== -1) {
      this.tupleType = s.substr(i + 1);
      s = s.substr(0, i);
    }

    this.encoding = s;
  }

  assignOpcode(s) {
    this.opcodeString = s;

    var parts = s.split(" ");
    var prefix, comp;
    var i;

    if (/^(EVEX|VEX|XOP)\./.test(s)) {
      // Parse VEX and EVEX encoded instruction.
      prefix = parts[0].split(".");

      for (i = 0; i < prefix.length; i++) {
        comp = prefix[i];

        // Process "EVEX", "VEX", and "XOP" prefixes.
        if (/^(?:EVEX|VEX|XOP)$/.test(comp)) { this.prefix = comp; continue; }
        // Process "NDS/NDD/DDS".
        if (/^(?:NDS|NDD|DDS)$/.test(comp)) { this.vvvv = comp; continue; }

        // Process `L` field.
        if (/^LIG$/      .test(comp)) { this.l = "LIG"; continue; }
        if (/^128|L0|LZ$/.test(comp)) { this.l = "128"; continue; }
        if (/^256|L1$/   .test(comp)) { this.l = "256"; continue; }
        if (/^512$/      .test(comp)) { this.l = "512"; continue; }

        // Process `PP` field - 66/F2/F3.
        if (comp === "P0") { /* ignored, `P` is zero... */ continue; }
        if (/^(?:66|F2|F3)$/.test(comp)) { this.pp = comp; continue; }

        // Process `MM` field - 0F/0F3A/0F38/M8/M9.
        if (/^(?:0F|0F3A|0F38|M8|M9)$/.test(comp)) { this.mm = comp; continue; }

        // Process `W` field.
        if (/^WIG|W0|W1$/.test(comp)) { this.w = comp; continue; }

        // ERROR.
        this.report(`'${this.opcodeString}' Unhandled component: ${comp}`);
      }

      for (i = 1; i < parts.length; i++) {
        comp = parts[i];

        // Parse opcode.
        if (/^[0-9A-Fa-f]{2}$/.test(comp)) {
          this.opcode = comp.toUpperCase();
          continue;
        }

        // Parse "/r" or "/0-7".
        if (/^\/[r0-7]$/.test(comp)) {
          this.rm = comp.charAt(1);
          continue;
        }

        // Parse immediate byte, word, dword, or qword.
        if (/^(?:ib|iw|id|iq|\/is4)$/.test(comp)) {
          this.imm += misc.immSize(comp);
          continue;
        }

        this.report(`'${this.opcodeString}' Unhandled opcode component: ${comp}`);
      }
    }
    else {
      // Parse X86/X64 instruction (including legacy MMX/SSE/3DNOW instructions).
      for (i = 0; i < parts.length; i++) {
        comp = parts[i];

        // Parse REX.W prefix.
        if (comp === "REX.W") {
          this.w = "W1";
          continue;
        }

        // Parse `PP` prefixes.
        if ((this.mm === "" && ((this.pp === ""   && /^(?:66|F2|F3)$/.test(comp)) ||
                                (this.pp === "66" && /^(?:F2|F3)$/   .test(comp))))) {
          this.pp += comp;
          continue;
        }

        // Parse `MM` prefixes.
        if ((this.mm === ""   && comp === "0F") ||
            (this.mm === "0F" && /^(?:01|3A|38)$/.test(comp))) {
          this.mm += comp;
          continue;
        }

        // Recognize "0F 0F /r XX" encoding.
        if (this.mm === "0F" && comp === "0F") {
          this.prefix = "3DNOW";
          continue;
        }

        // Parse opcode byte.
        if (/^[0-9A-F]{2}(?:\+[ri])?$/.test(comp)) {
          // Parse "+r" or "+i" suffix.
          if (comp.length > 2) {
            this.ri = true;
            comp = comp.substr(0, 2);
          }

          // Some instructions have form 0F AE XX, we treat the last byte as an opcode.
          if (this.mm === "0F" && this.opcode === "AE") {
            this.mm += this.opcode;
            this.opcode = comp;
            continue;
          }

          // FPU instructions are encoded as "PREFIX XX", where prefix is not the same
          // as MM prefixes used everywhere else. AsmJit internally extends MM field in
          // instruction tables to allow storing this prefix together with other "MM"
          // prefixes, currently the unused indexes are used, but if X86 moves forward
          // and starts using these we can simply use more bits in the opcode DWORD.
          if (!this.pp && this.opcode === "9B") {
            this.pp = this.opcode;
            this.opcode = comp;
            continue;
          }

          if (!this.mm && (/^(?:D8|D9|DA|DB|DC|DD|DE|DF)$/.test(this.opcode))) {
            this.mm = this.opcode;
            this.opcode = comp;
            continue;
          }

          if (this.opcode) {
            if (this.opcode === "67")
              this._67h = true;
            else
              this.report(`'${this.opcodeString}' Multiple opcodes, have ${this.opcode}, found ${comp}`);
          }

          this.opcode = comp;
          continue;
        }

        // Parse "/r" or "/0-7".
        if (/^\/[r0-7]$/.test(comp) && !this.rm) {
          this.rm = comp.charAt(1);
          continue;
        }

        // Parse immediate byte, word, dword, or qword.
        if (/^(?:ib|iw|id|iq)$/.test(comp)) {
          this.imm += misc.immSize(comp);
          continue;
        }

        // Parse displacement.
        if (/^(?:cb|cd)$/.test(comp) && !this.rel) {
          this.rel = comp === "cb" ? 1 : 4;
          continue;
        }

        // ERROR.
        this.report(`'${this.opcodeString}' Unhandled opcode component ${comp}`);
      }
    }

    // HACK: Fix instructions having opcode "01".
    if (this.opcode === "" && this.mm.indexOf("0F01") === this.mm.length - 4) {
      this.opcode = "01";
      this.mm = this.mm.substr(0, this.mm.length - 2);
    }

    if (this.opcode)
      this.opcodeInt = parseInt(this.opcode, 16);

    if (/^\/[0-7]$/.test(this.rm))
      this.rmInt = parseInt(this.rm.substr(1), 10);

    if (!this.opcode)
      this.report(`'${this.opcodeString}' Couldn't parse instruction's opcode`);
  }

  assignFlags(s) {
    // Parse individual flags separated by spaces.
    var flags = s.split(" ");

    for (var i = 0; i < flags.length; i++) {
      var flag = flags[i].trim();
      if (!flag) continue;

      var j = flag.indexOf("=");
      if (j !== -1)
        this.assignFlag(flag.substr(0, j), flag.substr(j + 1));
      else
        this.assignFlag(flag, true);
    }
  }

  assignFlag(name, value) {
    // Basics.
    if (kCpuArchitecture[name] === true) { this.arch         = name ; return; }
    if (kCpuFeatures[name]     === true) { this.cpu[name]    = true ; return; }
    if (kCpuFlags[name]        === true) { this.eflags[name] = value; return; }

    // Split AVX-512 flag having "-VL" suffix (shorthand) into two flags.
    if (/^AVX512\w+-VL$/.test(name) && kCpuFeatures[name.substr(0, name.length - 3)] === true) {
      var cpuFlag = name.substr(0, name.length - 3);
      this.cpu[cpuFlag] = true;
      this.cpu.AVX512VL = true;
      return;
    }

    switch (name) {
      case "LOCK"     : this.lock     = true; return;
      case "REP"      : this.rep      = true; return;
      case "REPZ"     : this.repz     = true; return;
      case "REPNZ"    : this.repnz     = true; return;
      case "FPU"      : this.fpu      = true; return;
      case "XCR"      : this.xcr      = value; return;

      case "kz"       : this.zmask    = true; // fall: {kz} implies {k}.
      case "k"        : this.kmask    = true; return;
      case "er"       : this.rnd      = true; // fall: {er} implies {sae}.
      case "sae"      : this.sae      = true; return;

      case "VOLATILE" :
        this.volatile = true;
        return;

      case "PRIVILEGE":
        if (!/^L[0123]$/.test(value))
          this.report(`${this.name}: Invalid privilege level '${value}'`);

        this.privilege = parseInt(value.substr(1), 10);
        return;

      case "broadcast":
        this.broadcast = true;
        this.elementSize = value;
        return;

      case "FPU_PUSH" : this.fpu = true; this.fpuTop = -1; return;
      case "FPU_POP"  : this.fpu = true; this.fpuTop = Number(value); return;
      case "FPU_TOP"  : this.fpu = true;
        if (value === "-1") { this.fpuTop =-1; return; }
        if (value === "+1") { this.fpuTop = 1; return; }
        break;
    }

    this.report(`${this.name}: Unhandled flag ${name}=${value}`);
  }

  // Validate the instruction's definition. Common mistakes can be checked and
  // reported easily, however, if the mistake is just an invalid opcode or
  // something else it's impossible to detect.
  validate() {
    var isValid = true;
    var immCount = this.getImmCount();

    var m;

    // Verify that the immediate operand/operands are specified in instruction
    // encoding and opcode field. Basically if there is an "ix" in operands,
    // the encoding should contain "I".
    if (immCount > 0) {
      var immEncoding = "I".repeat(immCount);

      // "I" or "II" should be part of the instruction encoding.
      if (this.encoding.indexOf(immEncoding) === -1) {
        isValid = false;
        this.report(`Immediate(s) [${immCount}] missing in encoding: ${this.encoding}`);
      }

      // Every immediate should have its imm byte ("ib", "iw", "id", or "iq") in the opcode data.
      m = this.opcodeString.match(/(?:^|\s+)(ib|iw|id|iq)/g);
      if (!m || m.length !== immCount) {
        isValid = false;
        this.report(`Immediate(s) [${immCount}] not found in opcode: ${this.opcodeString}`);
      }
    }

    // Verify that AVX/XOP or AVX-512 instruction always specifies L and W fields.
    // FIXME: Not passing, because Intel Manual sometimes doesn't specify W.
    /*
    if (this.isAVX() && (this.l === "" || this.w === "")) {
      this.report(`AVX instruction should specify L and W fields: L=${this.l} W=${this.w}`);
    }
    */

    // Verify that if the instruction uses the "VVVV" part of VEX/EVEX prefix,
    // that it has "NDS/NDD/DDS" part of the "VVVV" definition specified, and
    // that the definition matches the opcode encoding.

    return isValid;
  }

  report(msg) {
    console.log(`[X86Instruction:${this.name} ${this.operands.join(" ")}] ${msg}`);
    this.invalid++;
  }
}
exports.X86Instruction = X86Instruction;

// ============================================================================
// [X86DataBase]
// ============================================================================

// X86 instruction database - stores X86Instruction instances in a map and
// aggregates all instructions with the same name.
class X86DataBase {
  constructor() {
    // Instructions in a map, mapping an instruction name into an array of all
    // instructions defined for that name.
    this.map = Object.create(null);
    this.instructionNames = null;

    // Instruction statistics.
    this.stats = {
      insts : 0, // Number of all instructions.
      groups: 0, // Number of grouped instructions (having unique name).
      vex   : 0, // Number of VEX instructions.
      xop   : 0, // Number of XOP instructions.
      evex  : 0  // Number of EVEX instructions.
    };
  }

  addDefault() {
    this.addInstructions(x86data.instructions);
    return this;
  }

  addInstructions(instructions) {
    for (var i = 0; i < instructions.length; i++) {
      const instData = instructions[i];
      const instNames = instData[kIndexName].split("/");

      for (var j = 0; j < instNames.length; j++) {
        const instObj = new X86Instruction(
          instNames[j],
          instData[kIndexOperands],
          instData[kIndexEncoding],
          instData[kIndexOpcode],
          instData[kIndexFlags]);
        instObj.validate();
        this.addInstruction(instObj);
      }
    }

    return this;
  }

  addInstruction(inst) {
    var group;

    if (hasOwn.call(this.map, inst.name)) {
      group = this.map[inst.name];
    }
    else {
      group = this.map[inst.name] = [];
      this.instructionNames = null;
      this.stats.groups++;
    }

    group.push(inst);
    this.stats.insts++;

    // Misc statistics.
    if (inst.prefix === "VEX" ) this.stats.vex++;
    if (inst.prefix === "XOP" ) this.stats.xop++;
    if (inst.prefix === "EVEX") this.stats.evex++;

    return this;
  }

  getGroup(name) {
    return this.map[name] || null;
  }

  getInstructionNames() {
    const map = this.map;

    var names = this.instructionNames;
    if (names === null) {
      names = Object.keys(map);
      names.sort();
      this.instructionNames = names;
    }

    return names;
  }

  forEach(cb, thisArg) {
    const map = this.map;
    const names = this.getInstructionNames();

    for (var i = 0; i < names.length; i++) {
      const name = names[i];
      const list = map[name];

      for (var j = 0; j < list.length; j++)
        cb.call(thisArg, name, list[j]);
    }

    return this;
  }

  forEachGroup(cb, thisArg) {
    const map = this.map;
    const names = this.getInstructionNames();

    for (var i = 0; i < names.length; i++) {
      const name = names[i];
      cb.call(thisArg, name, map[name]);
    }

    return this;
  }

  print() {
    this.forEach(function(name, inst) {
      console.log(`${inst.name} ${inst.operands.join(", ")} ${inst.opcodeString} [${inst.opcode}]`);
    }, this);
  }
}
exports.X86DataBase = X86DataBase;

// ============================================================================
// [X86DataCheck]
// ============================================================================

class X86DataCheck {
  checkVexEvex(db) {
    const map = db.map;
    for (var name in map) {
      const insts = map[name];
      for (var i = 0; i < insts.length; i++) {
        const instA = insts[i];
        for (var j = i + 1; j < insts.length; j++) {
          const instB = insts[j];
          if (instA.operands.join("_") === instB.operands.join("_")) {
            const vex  = instA.prefix === "VEX"  ? instA : instB.prefix === "VEX"  ? instB : null;
            const evex = instA.prefix === "EVEX" ? instA : instB.prefix === "EVEX" ? instB : null;

            if (vex && evex && vex.opcode === evex.opcode) {
              // NOTE: There are some false positives, they will be printed as well.
              var ok = vex.w === evex.w && vex.l === evex.l;

              if (!ok) {
                console.log(`Instruction ${name} differs:`);
                console.log(`  ${vex.operands.join(" ")}: ${vex.opcodeString}`);
                console.log(`  ${evex.operands.join(" ")}: ${evex.opcodeString}`);
              }
            }
          }
        }
      }
    }
  }
}
exports.X86DataCheck = X86DataCheck;

}).apply(this, typeof module === "object" && module && module.exports
  ? [module, "exports"] : [this.asmdb || (this.asmdb = {}), "x86util"]);

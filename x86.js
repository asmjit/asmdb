// [x86.js]
// X86/X64 instruction-set utilities that use `x86data.js`.
//
// [License]
// Public Domain.

(function($export, $as) {
"use strict";

const x86 = $export[$as] = {};
const base = $export.base ? $export.base : require("./base.js");
const x86data = $export.x86data ? $export.x86data : require("./x86data.js");

const BaseISA = base.BaseISA;
const BaseOperand = base.BaseOperand;
const BaseInstruction = base.BaseInstruction;

const hasOwn = Object.prototype.hasOwnProperty;

// Creates an Object without a prototype (used as a map).
function dict() { return Object.create(null); }

// If something failed...
function fail(msg) { throw new Error("[X86] " + msg); }

// Replaces default arguments object (if not provided).
const NoObject = Object.freeze({});

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
      var m = /^([A-Za-z\(\)]+)(\d+)-(\d+)([A-Za-z\(\)]*)$/.exec(name);

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

const kCpuRegisters = buildCpuRegs(x86data.registers);
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
// [asmdb.x86.Utils]
// ============================================================================

// X86/X64 utilities.
class Utils {
  // Split the operand(s) string into individual operands as defined by the
  // instruction database.
  //
  // NOTE: X86/X64 doesn't require anything else than separating the commas,
  // this function is here for compatibility with other instruction sets.
  static splitOperands(s) {
    const array = s.split(",");
    for (var i = 0; i < array.length; i++)
      array[i] = array[i].trim();
    return array;
  }

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
x86.Utils = Utils;

// ============================================================================
// [asmdb.x86.Operand]
// ============================================================================

// X86/X64 operand.
class Operand extends BaseOperand {
  constructor(def, defaultAccess) {
    super(def);

    this.reg = "";             // Register operand's definition.
    this.regType = "";         // Register operand's type.

    this.mem = "";             // Memory operand's definition.
    this.memSize = -1;         // Memory operand's size.
    this.memOff = false;       // Memory operand is an absolute offset (only a specific version of MOV).
    this.memSeg = "";          // Segment specified with register that is used to perform a memory IO.
    this.vsibReg = "";         // AVX VSIB register type (xmm/ymm/zmm).
    this.vsibSize = -1;        // AVX VSIB register size (32/64).
    this.bcstSize = -1;        // AVX-512 broadcast size.

    this.imm = 0;              // Immediate operand's size.
    this.immValue = null;      // Immediate value - `null` or `1` (only used by shift/rotate instructions).
    this.rel = 0;              // Relative displacement operand's size.

    this.rwxIndex = -1;        // Read/Write (RWX) index.
    this.rwxWidth = -1;        // Read/Write (RWX) width.

    const type = [];
    var s = def;

    // Handle RWX decorators prefix in "R|W|X[A:B]:" format.
    const mAccess = /^(R|W|X)(\[(\d+)\:(\d+)\])?\:/.exec(s);
    if (mAccess) {
      // RWX:
      this.setAccess(mAccess[1]);

      // RWX[A:B]:
      if (mAccess.length > 2) {
        var a = parseInt(mAccess[2], 10);
        var b = parseInt(mAccess[3], 10);

        this.rwxIndex = Math.min(a, b);
        this.rwxWidth = Math.abs(a - b) + 1;
      }

      // Remove RWX information from the operand's string.
      s = s.substr(mAccess[0].length);
    }

    // Handle AVX-512 broadcast possibility specified as "/bN" suffix.
    var mBcst = /\/b(\d+)/.exec(s);
    if (mBcst) {
      this.bcstSize = parseInt(mBcst[1], 10);

      // Remove broadcast from the operand's definition; it's not needed anymore.
      s = s.substr(0, mBcst.index) + s.substr(mBcst.index + mBcst[0].length);
    }

    // Handle an implicit operand.
    if (s.charAt(0) === "<" && s.charAt(s.length - 1) === ">") {
      this.implicit = true;

      // Remove "<...>" from the operand's definition.
      s = s.substring(1, s.length - 1);
    }

    // Support multiple operands separated by "/" (only used by r/m style definition).
    var ops = s.split("/");
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i].trim();

      // Handle a segment specification if this is an implicit register performing
      // memory access.
      if (/^(?:ds|es)\:/.test(op)) {
        this.memSeg = op.substr(0, 2);
        op = op.substr(3);
      }

      if (Utils.isRegOp(op)) {
        this.reg = op;
        this.regType = Utils.regTypeOf(op);

        type.push("reg");
        continue;
      }

      if (Utils.isMemOp(op)) {
        this.mem = op;

        // Handle memory size.
        const mOff = /^m(?:off)?(\d+)/.exec(op);
        this.memSize = mOff ? parseInt(mOff[1], 10) : 0;
        this.memOff = op.indexOf("moff") === 0;

        // Handle vector addressing mode and size "vmXXr".
        const mVM = /^vm(\d+)(x|y|z)$/.exec(op);
        if (mVM) {
          this.vsibReg = mVM[2] + "mm";
          this.vsibSize = parseInt(mVM[1], 10);
        }

        type.push("mem");
        continue;
      }

      if (Utils.isImmOp(op)) {
        this.imm = Utils.immSize(op);
        if (op === "1") {
          this.implicit = true;
          this.immValue = 1;
        }

        type.push("imm");
        continue;
      }

      if (Utils.isRelOp(op)) {
        this.rel = Utils.relSize(op);

        type.push("rel");
        continue;
      }

      throw Error(`asmdb.x86.Operand(): Unhandled operand '${op}'`);
    }

    // In case the data has been modified it's always better to use the stripped off
    // version as we have already processed and stored all the possible decorators.
    this.data = s;
    this.type = type.join("/");

    if (!mAccess && this.isRegOrMem())
      this.setAccess(defaultAccess);
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
  isRegOrMem() { return !!this.reg || !!this.mem; }
  isRegAndMem() { return !!this.reg && !!this.mem; }

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
x86.Operand = Operand;

// ============================================================================
// [asmdb.x86.Instruction]
// ============================================================================

// X86/X64 instruction.
class Instruction extends BaseInstruction {
  constructor(db, name, operands, encoding, opcode, metadata) {
    super(db);

    this.name = name;
    this.privilege = "L3";     // Privilege level required to execute the instruction.
    this.prefix = "";          // Prefix - "", "3DNOW", "EVEX", "VEX", "XOP".
    this.opcodeHex = "";       // A single opcode byte as hexadecimal string "00-FF".

    this.l = "";               // Opcode L field (nothing, 128, 256, 512).
    this.w = "";               // Opcode W field.
    this.pp = "";              // Opcode PP part.
    this.mm = "";              // Opcode MM[MMM] part.
    this.vvvv = "";            // Opcode VVVV part.
    this._67h = false;         // Instruction requires a size override prefix.

    this.rm = "";              // Instruction specific payload "/0..7".
    this.rmInt = -1;           // Instruction specific payload as integer (0-7).
    this.ri = false;           // Instruction opcode is combined with register, "XX+r" or "XX+i".
    this.rel = 0;              // Displacement (cb cw cd parts).

    this.fpu = false;          // If the instruction is an FPU instruction.
    this.fpuTop = 0;           // FPU top index manipulation [-1, 0, 1, 2].

    this.vsibReg = "";         // AVX VSIB register type (xmm/ymm/zmm).
    this.vsibSize = -1;        // AVX VSIB register size (32/64).

    this.broadcast = false;    // AVX-512 broadcast support.
    this.bcstSize = -1;        // AVX-512 broadcast size.

    this.kmask = false;        // AVX-512 merging {k}.
    this.zmask = false;        // AVX-512 zeroing {kz}, implies {k}.
    this.sae = false;          // AVX-512 suppress all exceptions {sae} support.
    this.rnd = false;          // AVX-512 embedded rounding {er}, implies {sae}.

    this.tupleType = "";       // AVX-512 tuple-type.
    this.elementSize = -1;     // Instruction's element size.

    this._assignOperands(operands);
    this._assignEncoding(encoding);
    this._assignOpcode(opcode);
    this._assignMetadata(metadata);
    this._postProcess();
  }

  _assignOperands(s) {
    if (!s) return;

    // First remove all flags specified as {...}. We put them into `flags`
    // map and mix with others. This seems to be the best we can do here.
    for (;;) {
      var a = s.indexOf("{");
      var b = s.indexOf("}");

      if (a === -1 || b === -1)
        break;

      // Get the `flag` and remove from `s`.
      this._assignAttribute(s.substring(a + 1, b), true);
      s = s.substr(0, a) + s.substr(b + 1);
    }

    // Split into individual operands and push them to `operands`.
    const arr = Utils.splitOperands(s);
    for (var i = 0; i < arr.length; i++) {
      const opstr = arr[i];
      const operand = new Operand(opstr, i === 0 ? "X" : "R");

      // Propagate broadcast.
      if (operand.bcstSize > 0)
        this._assignAttribute("broadcast", operand.bcstSize);

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

  _assignEncoding(s) {
    // Parse 'TUPLE-TYPE' as defined by AVX-512.
    var i = s.indexOf("-");
    if (i !== -1) {
      this.tupleType = s.substr(i + 1);
      s = s.substr(0, i);
    }

    this.encoding = s;
  }

  _assignOpcode(s) {
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
          this.opcodeHex = comp.toUpperCase();
          continue;
        }

        // Parse "/r" or "/0-7".
        if (/^\/[r0-7]$/.test(comp)) {
          this.rm = comp.charAt(1);
          continue;
        }

        // Parse immediate byte, word, dword, or qword.
        if (/^(?:ib|iw|id|iq|\/is4)$/.test(comp)) {
          this.imm += Utils.immSize(comp);
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
          if (this.mm === "0F" && this.opcodeHex === "AE") {
            this.mm += this.opcodeHex;
            this.opcodeHex = comp;
            continue;
          }

          // FPU instructions are encoded as "PREFIX XX", where prefix is not the same
          // as MM prefixes used everywhere else. AsmJit internally extends MM field in
          // instruction tables to allow storing this prefix together with other "MM"
          // prefixes, currently the unused indexes are used, but if X86 moves forward
          // and starts using these we can simply use more bits in the opcode DWORD.
          if (!this.pp && this.opcodeHex === "9B") {
            this.pp = this.opcodeHex;
            this.opcodeHex = comp;
            continue;
          }

          if (!this.mm && (/^(?:D8|D9|DA|DB|DC|DD|DE|DF)$/.test(this.opcodeHex))) {
            this.mm = this.opcodeHex;
            this.opcodeHex = comp;
            continue;
          }

          if (this.opcodeHex) {
            if (this.opcodeHex === "67")
              this._67h = true;
            else
              this.report(`'${this.opcodeString}' Multiple opcodes, have ${this.opcodeHex}, found ${comp}`);
          }

          this.opcodeHex = comp;
          continue;
        }

        // Parse "/r" or "/0-7".
        if (/^\/[r0-7]$/.test(comp) && !this.rm) {
          this.rm = comp.charAt(1);
          continue;
        }

        // Parse immediate byte, word, dword, or qword.
        if (/^(?:ib|iw|id|iq)$/.test(comp)) {
          this.imm += Utils.immSize(comp);
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
    if (this.opcodeHex === "" && this.mm.indexOf("0F01") === this.mm.length - 4) {
      this.opcodeHex = "01";
      this.mm = this.mm.substr(0, this.mm.length - 2);
    }

    if (this.opcodeHex)
      this.opcodeValue = parseInt(this.opcodeHex, 16);

    if (/^\/[0-7]$/.test(this.rm))
      this.rmInt = parseInt(this.rm.substr(1), 10);

    if (!this.opcodeHex)
      this.report(`Couldn't parse instruction's opcode '${this.opcodeString}'`);
  }

  _assignSpecificAttribute(name, value) {
    const db = this.db;

    // Basics.
    if (name == "X86" || name === "X64" || name === "ANY") {
      this.arch = name;
      return true;
    }

    // AVX-512 flag followed by "-VL" suffix is a combination of two extensions.
    if (/^AVX512\w+-VL$/.test(name) && db.extensions[name.substr(0, name.length - 3)]) {
      const ext = name.substr(0, name.length - 3);
      this.extensions[ext] = true;
      this.extensions.AVX512_VL = true;
      return true;
    }

    switch (name) {
      case "FPU":
        this.fpu = true;
        return true;

      case "kz":
        this.zmask = true;
        // fall: {kz} implies {k}.
      case "k":
        this.kmask = true;
        return true;

      case "er":
        this.rnd = true;
        // fall: {er} implies {sae}.
      case "sae":
        this.sae = true;
        return true;

      case "PRIVILEGE":
        if (!/^L[0123]$/.test(value))
          this.report(`${this.name}: Invalid privilege level '${value}'`);

        this.privilege = value;
        return true;

      case "broadcast":
        this.broadcast = true;
        this.elementSize = value;
        return true;

      case "FPU_PUSH" :
        this.fpu = true;
        this.fpuTop = -1;
        return true;

      case "FPU_POP":
        this.fpu = true;
        this.fpuTop = Number(value);
        return true;

      case "FPU_TOP":
        this.fpu = true;
        if (value === "-1") { this.fpuTop =-1; return true; }
        if (value === "+1") { this.fpuTop = 1; return true; }
        break;
    }

    return false;
  }

  // Validate the instruction's definition. Common mistakes can be checked and
  // reported easily, however, if the mistake is just an invalid opcode or
  // something else it's impossible to detect.
  _postProcess() {
    var isValid = true;
    var immCount = this.getImmCount();

    var m;

    // Verify that the immediate operand/operands are specified in instruction
    // encoding and opcode field. Basically if there is an "ix" in operands,
    // the encoding should contain "I".
    if (immCount > 0) {
      var immEncoding = "I".repeat(immCount);

      // "I" or "II" should be part of the encoding.
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

  // Get signature of the instruction as "ARCH PREFIX ENCODING[:operands]" form.
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
}
x86.Instruction = Instruction;

// ============================================================================
// [asmdb.x86.ISA]
// ============================================================================

// X86/X64 instruction database - stores Instruction instances in a map and
// aggregates all instructions with the same name.
class ISA extends BaseISA {
  constructor(args) {
    super(args);

    if (!args)
      args = NoObject;

    if (args.builtins !== false)
      this.addData(x86data);

    this.addData(args);
  }

  _createInstruction(name, operands, encoding, opcode, metadata) {
    return new Instruction(this, name, operands, encoding, opcode, metadata);
  }
}
x86.ISA = ISA;

// ============================================================================
// [asmdb.x86.X86DataCheck]
// ============================================================================

class X86DataCheck {
  static checkVexEvex(db) {
    const map = db.instructionMap;
    for (var name in map) {
      const insts = map[name];
      for (var i = 0; i < insts.length; i++) {
        const instA = insts[i];
        for (var j = i + 1; j < insts.length; j++) {
          const instB = insts[j];
          if (instA.operands.join("_") === instB.operands.join("_")) {
            const vex  = instA.prefix === "VEX"  ? instA : instB.prefix === "VEX"  ? instB : null;
            const evex = instA.prefix === "EVEX" ? instA : instB.prefix === "EVEX" ? instB : null;

            if (vex && evex && vex.opcodeHex === evex.opcodeHex) {
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
x86.X86DataCheck = X86DataCheck;

}).apply(this, typeof module === "object" && module && module.exports
  ? [module, "exports"] : [this.asmdb || (this.asmdb = {}), "x86"]);

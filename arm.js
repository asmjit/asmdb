// [arm.js]
// ARM instruction-set utilities that use `armdata.js`.
//
// [License]
// Public Domain.

(function($export, $as) {
"use strict";

const arm = $export[$as] = {};
const base = $export.armdata ? $export.base : require("./base.js");
const armdata = $export.armdata ? $export.armdata : require("./armdata.js");

// Creates an Object without a prototype (used as a map).
function dict() { return Object.create(null); }

// ============================================================================
// [asmdb.arm.Utils]
// ============================================================================

// Can be used to assign the number of bits each part of the opcode occupies.
// NOTE: THUMB instructions that uses halfword must always specify the width
// of all registers as many instructictions accept only LO (r0..r7) registers.
const PartBits = {
  "P"   : 1,
  "U"   : 1,
  "W"   : 1,
  "S"   : 1,
  "R"   : 1,
  "J1"  : 1,
  "J2"  : 1,
  "Type": 2,
  "Cond": 4,
  "Rd"  : 4,
  "RdLo": 4,
  "RdHi": 4,
  "Rx"  : 4,
  "Rn"  : 4,
  "Rm"  : 4,
  "Ra"  : 4,
  "Rs"  : 4,
  "Rt"  : 4,
  "Rt2" : 4
};

// ARM utilities.
class Utils {
  // Matches the closing bracket, like `indexOf()`, but uses a counter and skips
  // all nested brackets.
  static matchClosingBracket(s, from) {
    const opening = s.charCodeAt(from);
    const closing = opening === 40  ? 31  :    // ().
                    opening === 60  ? 62  :    // <>.
                    opening === 91  ? 93  :    // [].
                    opening === 123 ? 125 : 0; // {}.

    const len = s.length;

    var i = from;
    var pending = 1;

    do {
      if (++i >= len)
        break;

      const c = s.charCodeAt(i);
      pending += Number(c === opening);
      pending -= Number(c === closing);
    } while (pending);

    return i;
  }

  static splitOperands(s) {
    const result = [];

    s = s.trim();
    if (!s) return result;

    var start = 0;
    var i = 0;
    var c = "";

    for (;;) {
      if (i === s.length || (c = s[i]) === ",") {
        const op = s.substring(start, i).trim();
        if (!op)
          throw new Error(`asmdb.arm.Utils.splitOperands(): Found empty operand in '${s}'`);

        result.push(op);
        if (i === s.length)
          return result;

        start = ++i;
        continue;
      }

      if (c === "[" || c === "{")
        i = Utils.matchClosingBracket(s, i);
      else
        i++;
    }
  }
}
arm.Utils = Utils;

// ============================================================================
// [asmdb.arm.Operand]
// ============================================================================

// ARM operand.
class Operand {
  constructor(data, defaultAccess) {
    this.data = data;       // The operand's data (possibly processed).
    this.type = "";         // Type of the operand.

    this.read = false;      // True if the operand is a read-op (R or X) from reg/mem.
    this.write = false;     // True if the operand is a write-op (W or X) to reg/mem.
    this.sign = false;      // Operand (Immediate, Register, Memory) has a separate sign (+/-).
    this.optional = false;  // Operand is {optional} (only immediates, zero in such case).

    if (data.startsWith("{") && data.endsWith("}")) {
      data = data.substring(1, data.length - 1);
      this.data = data;
      this.optional = true;
    }

    if (data.startsWith("[")) {
      var mem = data;

      if (mem.endsWith("{!}")) {
        mem = mem.substr(0, mem.length - 3);
      }
      else if (mem.endsWith("!")) {
        mem = mem.substr(0, mem.length - 1);
      }

      if (!mem.endsWith("]"))
        throw new Error(`asmdb.arm.Operand(): Unknown memory operand '${data}'`);

      // --- Setup memory operand ---
      this.type = "mem";
      this.mem = "";          // Memory operand's definition.
      this.memType = "";      // Memory operand's type.
    }
    else if (data.startsWith("#")) {
      var imm = data.substr(1);
      var mul = imm.match(/\*\s*(\d+)$/);
      var scale = 1;

      if (mul) {
        imm = data.substr(0, mul.index);
        scale = parseInt(mul[1], 10);
      }

      // --- Setup immediate operand ---
      this.type = "imm";
      this.imm = imm;         // Immediate operand name (also representing its type).
      this.immSize = 0;       // Immediate size in bits.
      this.immScale = scale;  // Immediate scale (image is multiplied by this constant by CPU before its used).
    }
    else {
      var reg = data;
      var regType = reg.substr(0, 1).toLowerCase();
      var regCond = "";

      var eq = reg.indexOf("==");
      var ne = reg.indexOf("!=");

      if (eq !== -1) { regCond = reg.substr(eq); reg = reg.substr(0, eq); }
      if (ne !== -1) { regCond = reg.substr(ne); reg = reg.substr(0, ne); }

      // --- Setup register operand ---
      this.type = "reg";
      this.reg = reg;         // Register name (as specified in manual).
      this.regType = regType; // Register type.
      this.regCond = regCond; // Register condition.
    }
  }

  get name() {
    switch (this.type) {
      case "reg": return this.reg;
      case "mem": return this.mem;
      case "imm": return this.imm;
      case "rel": return this.rel;
      default:
        return "";
    }
  }

  isReg() { return this.type === "reg"; }
  isMem() { return this.type === "mem"; }
  isImm() { return this.type === "imm"; }
  isRel() { return this.type === "rel"; }

  toString() { return this.data; }
}
arm.Operand = Operand;

// ============================================================================
// [asmdb.arm.Instruction]
// ============================================================================

// ARM instruction.
class Instruction {
  constructor(name, operands, encoding, opcode, flags) {
    // We use table encoding as arch as it's always one of T16/T32/A16/A64, which
    // describes how the instruction is encoded and also the processor mode it
    // requires to run. The encoding field will be expanded accordingly to the
    // opcode value.

    this.name = name;         // Instruction name.
    this.arch = encoding;     // Architecture - T16/T32/A32/A64.
    this.encoding = "";       // Instruction encoding.

    this.opcodeWord = 0;      // The whole opcode value (number) without all dynamic parts.
    this.opcodeString = "";   // The whole opcode string, as specified in manual.

    this.implicit = false;    // Uses implicit operands (registers / memory).
    this.volatile = false;    // Volatile instruction hint for the instruction scheduler.

    this.cpu = dict();        // CPU features required to execute the instruction.
    this.operands = [];       // Instruction operands array.

    this.assignOperands(operands);
    this.assignOpcode(opcode);
  }

  assignOperands(s) {
    if (!s) return;

    // Split into individual operands and push them to `operands`.
    const parts = Utils.splitOperands(s);
    for (var i = 0; i < parts.length; i++) {
      const data = parts[i].trim();
      const operand = new Operand(data);

      this.operands.push(operand);
    }
  }

  assignOpcode(s) {
    this.opcodeString = s;

    var map = Object.create(null);

    var opcodeWord = 0;
    var opcodeBits = 0;

    // Split opcode into its parts.
    const parts = s.split("|");
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      var m;

      var bits = 0;
      var mask = 0;
      var size = 0;

      if (/^[0-1]+$/.test(part)) {
        // This part of the opcode are RAW bits.
        size = part.length;
        opcodeWord <<= size;
        opcodeBits += size;
        opcodeWord |= parseInt(part, 2);
      }
      else {
        if ((m = part.match(/\[\s*(\d+)\s*\:\s*(\d+)\s*\]$/))) {
          const a = parseInt(m[1], 10);
          const b = parseInt(m[2], 10);
          if (a < b)
            throw new Error(`asmdb.arm.Instruction.assignOpcode(): Invalid bit range '${part}' in opcode '${s}'`);

          size = a - b + 1;
          mask = ((1 << size) - 1) << b;
          part = part.substr(0, m.index).trim();
        }
        else if ((m = part.match(/\[\s*(\d+)\s*\]$/))) {
          const ab = parseInt(m[1], 10);
          size = 1;
          mask = 1 << ab;
          part = part.substr(0, m.index).trim();
        }
        else if ((m = part.match(/\:\s*(\d+)$/))) {
          size = parseInt(m[1], 10);
          bits = bits;
          part = part.substr(0, m.index).trim();
        }
        else if (PartBits[part]) {
          // Sizes of some standard fields can be assigned automatically.
          size = PartBits[part];
          bits = size;
        }
        else {
          throw new Error(`asmdb.arm.Instruction.assignOpcode(): Cannot recognize the size of part '${part}' of opcode '${s}'`);
        }

        const item = map[part] || (map[part] = { bits: 0, mask: 0 });
        item.bits += bits;
        item.mask |= mask;

        opcodeWord <<= size;
        opcodeBits += size;
      }
    }

    // Fixup all parts.
    for (var part in map) {
      const item = map[part];

      // There should be either number of bits or mask, there shouldn't be both.
      if (item.bits) {
        if (item.mask)
          throw new Error(`asmdb.arm.Instruction.assignOpcode(): Part '${part}' of opcode '${s}' contains both, bits and mask`);

        item.mask = ((1 << item.bits) - 1) << item.bits;
      }
      else if (item.mask) {
        item.bits = 32 - Math.clz32(item.mask);
      }

      const op = this.getOperandByName(part);
      if (op && op.isImm()) op.immSize = item.bits;
      // if (!op) console.log(`CANNOT FIND ${part}`);
    }

    // Check if the opcode word has correct number of bits (either 16 or 32).
    if (opcodeBits !== 16 && opcodeBits !== 32)
      throw new Error(`asmdb.arm.Instruction.assignOpcode(): The number of opcode bits (${opcodeBits}) in '${s}' doesn't match 16 or 32`);
    this.opcodeWord = opcodeWord;
  }

  getOperandByName(name) {
    const operands = this.operands;
    for (var i = 0; i < operands.length; i++) {
      const op = operands[i];
      if (op.name === name)
        return op;
    }
    return null;
  }

  postValidate() {
  }

  toString() {
    return `${this.name} ${this.operands.join(", ")}`;
  }
}
arm.Instruction = Instruction;

// ============================================================================
// [asmdb.arm.DB]
// ============================================================================

class DB extends base.BaseDB {
  constructor() {
    super();
  }

  createInstruction(name, operands, encoding, opcode, flags) {
    return new Instruction(name, operands, encoding, opcode, flags);
  }

  updateStats(inst) {
    return this;
  }

  addDefault() {
    this.addInstructions(armdata.instructions);
    return this;
  }
}
arm.DB = DB;

}).apply(this, typeof module === "object" && module && module.exports
  ? [module, "exports"] : [this.asmdb || (this.asmdb = {}), "arm"]);

// [X86/X64 - Generator]
// X86/X64 instruction table generator targeting AsmJit.

"use strict";

var fs = require("fs");
var x86db = require("./arch-x86db");

var hasOwn = Object.prototype.hasOwnProperty;

// ============================================================================
// [Class]
// ============================================================================

// Minimalist class-based system.
function Class(opt) {
  var C = opt.$construct || function() {};
  var p = C.prototype;

  for (var k in opt)
    if (k !== "$construct")
      p[k] = opt[k];

  return C;
}

// ============================================================================
// [Utils]
// ============================================================================

var Utils = {
  // String comparison, returns 0, -1, or 1.
  strcmp: function(a, b) { return (a < b) ? -1 : a === b ? 0 : 1; },
  // Trim left side of a string `s` and return a new string.
  trimLeft: function(s) { return s ? s.replace(/^\s+/, "") : ""; },
  // Uppercase the first character of a string `s` and return a new string.
  upFirst: function(s) { return s ? s.charAt(0).toUpperCase() + s.substr(1) : ""; },

  // Repeat a string `s` by `n` times.
  repeat: function(s, n) {
    var out = "";
    for (var i = 0; i < n; i++) out += s;
    return out;
  },

  // Pad `s` left with spaces so the resulting string has `n` characters total.
  padLeft: function(s, n) { return Utils.repeat(" ", Math.max(n - s.length, 0)) + s; },
  // Pad `s` right with spaces so the resulting string has `n` characters total.
  padRight: function(s, n) { return s + Utils.repeat(" ", Math.max(n - s.length, 0)); },

  mapFromArray: function(arr) {
    var map = {};
    for (var i = 0; i < arr.length; i++)
      map[arr[i]] = true;
    return map;
  },
  
  // Inject `data` to the string `s` replacing the content from `start` to `end`.
  inject: function(s, start, end, data) {
    var iStart = s.indexOf(start);
    var iEnd   = s.indexOf(end);

    if (iStart === -1) throw new Error("Couldn't locate start mark.");
    if (iEnd   === -1) throw new Error("Couldn't locate end mark.");

    return s.substr(0, iStart + start.length) + data + s.substr(iEnd);
  },

  // Build an object containing CPU registers as keys mapping them to a registers' group.
  buildCpuRegs: function(defs) {
    var obj = {};

    for (var group in defs) {
      var regs = defs[group];
      for (var i = 0; i < regs.length; i++) {
        var r = regs[i];
        var m = /^(\w+)(\d+)-(\d+)(\w*)$/.exec(r);

        if (m) {
          var a = parseInt(m[2], 10);
          var b = parseInt(m[3], 10);

          for (var n = a; n <= b; n++)
            obj[m[1] + n + m[4]] = group;
        }
        else {
          obj[r] = group;
        }
      }
    }

    return obj;
  }
};

// ============================================================================
// [Constants]
// ============================================================================

// Indexes used by x86 data.
var kIndexName       = 0;
var kIndexOperands   = 1;
var kIndexEncoding   = 2;
var kIndexOpcode     = 3;
var kIndexFlags      = 4;

var kCpuArchitecture = Utils.mapFromArray(x86db.architectures);
var kCpuFeatures     = Utils.mapFromArray(x86db.features);

// Only registers used by instructions.
var kCpuRegs = Utils.buildCpuRegs({
  "reg": [
    "r8", "r16", "r32", "r64", "reg", "rxx",
    "al", "ah" , "ax" , "eax", "rax", "zax",
    "bl", "bh" , "bx" , "ebx", "rbx", "zbx",
    "cl", "ch" , "cx" , "ecx", "rcx", "zcx",
    "dl", "dh" , "dx" , "edx", "rdx", "zdx",
    "di", "edi", "rdi", "zdi",
    "si", "esi", "rsi", "zsi",
    "bp", "ebp", "rbp", "zbp",
    "sp", "esp", "rsp", "zsp"
  ],
  "sreg": ["sreg" , "cs", "ds", "es", "fs", "gs", "ss"],
  "creg": ["creg" , "cr0-8"  ],
  "dreg": ["dreg" , "dr0-7"  ],
  "st"  : ["st(0)", "st(i)"  ],
  "mm"  : ["mm"   , "mm0-7"  ],
  "k"   : ["k"    , "k0-7"   ],
  "xmm" : ["xmm"  , "xmm0-31"],
  "ymm" : ["ymm"  , "ymm0-31"],
  "zmm" : ["zmm"  , "zmm0-31"]
});

var kCpuFlags = {
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
// [CombinedString]
// ============================================================================

// Combined string is used to combine multiple strings into a single string and
// helpers to export a working C/C++ code that can be injected to a .cpp file.
//
// It helps to store a large amount of small strings without a need for runtime
// relocation. For example if you want to store 3 strings, "morning", "noon",
// and "evening", a `CombinedString` will be used like this:
//
// ```
// var combined = new CombinedString();
// combined.add("morning");
// combined.add("noon");
// combined.add("evening");
// ```
//
// Then a `CombinedString.format()` method can be called to generate a C/C++
// code of that string:
//
// ```
// const char combined[] =
//   "evening\0"
//   "morning\0"
//   "noon\0";
// ```
var CombinedString = Class({
  $construct: function() {
    this.map = {};   // Access an index based on string.
    this.array = []; // Access a string based on the index.
    this.total = 0;  // Total size of all strings including their NULL terminators.
  },

  // Get index of a string `s`.
  get: function(s) {
    return hasOwn.call(this.map, s) ? this.map[s] : -1;
  },

  // Add a string `s` into the combined string.
  //
  // The string is only added once, multiple strings will always refer to the
  // same index.
  add: function(s) {
    if (hasOwn.call(this.map, s))
      return this.map[s];

    var i = this.total;
    this.total += s.length + 1;

    this.map[s] = i;
    this.array.push(s);

    return i;
  },

  format: function(indent) {
    var a = this.array;
    var s = "";

    for (var i = 0; i < a.length; i++) {
      s += indent;
      s += "\"" + a[i] + "\\0\"";
      s += ((i === a.length - 1) ? ";" : "") + "\n";
    }

    return s;
  }
});

// ============================================================================
// [X86Util]
// ============================================================================

// X86/X64 utilities.
var X86Util = {
  // Get whether the string `s` describes a register operand.
  isRegOp: function(s) { return s && hasOwn.call(kCpuRegs, s); },
  // Get whether the string `s` describes a memory operand.
  isMemOp: function(s) { return s && /^(?:mem|mxx|(?:m(?:off)?\d+(?:dec|bcd|fp|int)?)|(?:vm\d+(?:x|y|z)))$/.test(s); },
  // Get whether the string `s` describes an immediate operand.
  isImmOp: function(s) { return s && /^(?:1|ib|iw|id|iq)$/.test(s); },
  // Get whether the string `s` describes a relative displacement (label).
  isRelOp: function(s) { return s && /^rel\d+$/.test(s); },
  // Get a register class based on string `s`, or `null` if `s` is not a register.
  regClass: function(s) { return kCpuRegs[s] || null; },

  // Get size in bytes of an immediate `s`.
  //
  // Handles "ib", "iw", "id", "iq", and also "/is4".
  immSize: function(s) {
    if (s === "1" ) return 0;
    if (s === "ib" || s === "/is4") return 1;
    if (s === "iw") return 2;
    if (s === "id") return 4;
    if (s === "iq") return 8;

    return -1;
  },

  // Get size in bytes of a relative displacement.
  //
  // Handles "rel8" and "rel32".
  relSize: function(s) {
    if (s === "rel8") return 1;
    if (s === "rel32") return 4;

    return -1;
  }
};

// ============================================================================
// [X86Operand]
// ============================================================================

// X86/X64 operand
var X86Operand = Class({
  $construct: function(data, defaultAccess) {
    this.data = data;       // The operand's data (processed).

    this.reg = "";          // Register operand's definition.
    this.regClass = "";     // Register operand's class.
    this.regMem = "";       // Segment specified with register that is used to perform a memory IO.

    this.mem = "";          // Memory operand's definition.
    this.memSize = -1;      // Memory operand's size.
    this.memOff = false;    // Memory operand is an absolute offset (only a specific version of MOV).
    this.vsibReg = "";      // AVX VSIB register type (xmm/ymm/zmm).
    this.vsibSize = -1;     // AVX VSIB register size (32/64).
    this.bcstSize = -1;     // AVX-512 broadcast size.

    this.imm = 0;           // Immediate operand's size.
    this.rel = 0;           // Relative displacement operand's size.

    this.implicit = false;  // True if the operand is an implicit register (i.e. not encoded in binary).
    this.read = false;      // True if the operand is a read (R or X) from reg/mem.
    this.write = false;     // True if the operand is a write (W or X) to reg/mem.
    this.rwxIndex = -1;     // Operation (RWX) index.
    this.rwxWidth = -1;     // Operation (RWX) width.

    // Handle RWX decorators prefix in "R|W|X[A:B]:" format.
    var m = /^(R|W|X)(\[(\d+)\:(\d+)\])?\:/.exec(data);
    if (m) {
      // RWX.
      this.setAccess(m[1]);

      // RWX Index/Width.
      if (m.length > 2) {
        var a = parseInt(m[2], 10);
        var b = parseInt(m[3], 10);

        this.rwxIndex = Math.min(a, b);
        this.rwxWidth = Math.abs(a - b) + 1;
      }

      // Remove RWX information from the operand's definition.
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

      // Handle segment specification if this is an implicit register performing
      // a memory access.
      if (/^(?:ds|es)\:/.test(op)) {
        this.regMem = op.substr(0, 2);
        op = op.substr(3);
      }

      if (X86Util.isRegOp(op)) {
        this.reg = op;
        this.regClass = X86Util.regClass(op);

        continue;
      }

      if (X86Util.isMemOp(op)) {
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

      if (X86Util.isImmOp(op)) {
        this.imm = X86Util.immSize(op);
        if (op === "1")
          this.implicit = true;
        continue;
      }

      if (X86Util.isRelOp(op)) {
        this.rel = X86Util.relSize(op);
        continue;
      }

      console.log("Unhandled operand: '" + op + "'");
    }
  },

  setAccess: function(access) {
    this.read  = access === "R" || access === "X";
    this.write = access === "W" || access === "X";
    return this;
  },

  isReg: function() { return !!this.reg; },
  isMem: function() { return !!this.mem; },
  isImm: function() { return !!this.imm; },
  isRel: function() { return !!this.rel; },

  isRegAndMem: function() { return !!this.reg && !!this.mem; },
  isRegOrMem : function() { return !!this.reg || !!this.mem; },

  toRegMem: function() {
    if (this.reg && this.mem)
      return this.reg + "/" + "m";
    else if (this.mem && (this.vsibReg || /fp$|int$/.test(this.mem)))
      return this.mem;
    else if (this.mem)
      return "m";
    else
      return this.toString();
  },

  toString: function() { return this.data; }
});

// ============================================================================
// [X86Inst]
// ============================================================================

// X86/X64 instruction.
var X86Inst = Class({
  $construct: function(name, operands, encoding, opcode, flags) {
    this.name = name;       // Instruction name.
    this.arch = "ANY";      // Architecture - ANY, X86, X64.

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
    this.rel = 0;           // Opcode displacement (cb cw cd parts).

    // Encoding & operands.
    this.encoding = "";     // Opcode encoding.
    this.operands = [];     // Instruction operands array.
    this.implicit = false;  // Instruction uses implicit operands (registers / memory).

    // Metadata.
    this.lock = false;      // Can be used with LOCK prefix.
    this.rep = false;       // Can be used with REP prefix.
    this.xcr = "";          // Reads or writes to/from XCR register.
    this.cpu = {};          // CPU features required to execute the instruction.
    this.eflags = {};       // CPU flags read/written/zeroed/set/undefined.

    this.volatile = false;  // Volatile instruction hint for the instruction scheduler.
    this.privilege = 3;     // Privilege level required to execute the instruction.

    this.fpu = false;       // Whether the instruction is a FPU instruction.
    this.mmx = false;       // Whether the instruction is a MMX instruction.
    this.fpuTop = 0;        // FPU top index manipulation [-1, 0, 1, 2].

    this.vsibReg = "";      // AVX VSIB register type (xmm/ymm/zmm).
    this.vsibSize = -1;     // AVX VSIB register size (32/64).

    this.broadcast = false; // AVX-512 broadcast support.
    this.bcstSize = -1;     // AVX-512 broadcast size.
    this.kmask = false;     // AVX-512 merging {k}.
    this.zmask = false;     // AVX-512 zeroing {kz}, implies {k}.
    this.sae = false;       // AVX-512 suppress all exceptions {sae}.
    this.rnd = false;       // AVX-512 embedded rounding {er}, implies {sae}.

    // Instruction element size, used by broadcast, but also defined for all
    // instructions that don't do broadcast. If the element size is ambiguous
    // (e.g. the instruction converts from one size to another) it contains
    // the source operand size, as source is used in memory broadcasts.
    this.elementSize = -1;

    // Every call to report increments invalid counter. Nonzero counter will
    // prevent generating instruction tables for AsmJit.
    this.invalid = 0;

    this.assignOperands(operands);
    this.assignEncoding(encoding);

    this.assignOpcode(opcode);
    this.assignFlags(flags);
  },

  isAVX : function() { return this.isVEX() || this.isEVEX(); },
  isVEX : function() { return this.prefix === "VEX" || this.prefix === "XOP"; },
  isEVEX: function() { return this.prefix === "EVEX" },

  // Get signature of the instruction in form "ARCH PREFIX ENCODING[:operands]"
  getSignature: function() {
    var operands = this.operands;
    var sign = this.arch;

    if (this.prefix) {
      sign += " " + this.prefix;
      if (this.prefix !== "3DNOW") {
        if (this.l === "L1")
          sign += ".256";
        else if (this.l === "256" || this.l === "512")
          sign += "." + this.l;
        else
          sign += ".128";

        if (this.w === "W1")
          sign += ".W";
      }
    }
    else if (this.w === "W1") {
      sign += " " + "REX.W";
    }

    sign += " " + this.encoding;

    for (var i = 0; i < operands.length; i++) {
      sign += (i === 0) ? ":" : ",";

      var operand = operands[i];
      if (operand.implicit)
        sign += "[" + operand.reg + "]";
      else
        sign += operand.toRegMem();
    }

    return sign;
  },

  getImmCount: function() {
    var ops = this.operands;
    var n = 0;

    for (var i = 0; i < ops.length; i++) {
      if (ops[i] === "imm")
        n++;
    }

    return n;
  },

  assignOperands: function(s) {
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
          this.report("Only one operand can be vector memory address (vmNNx)");
        }

        this.vsibReg = operand.vsibReg;
        this.vsibSize = operand.vsibSize;
      }

      this.operands.push(operand);
    }
  },

  assignEncoding: function(s) {
    this.encoding = s;
  },

  assignOpcode: function(s) {
    this.opcodeString = s;

    var parts = s.split(" ");
    var i;

    if (/^(EVEX|VEX|XOP)\./.test(s)) {
      // Parse VEX and EVEX encoded instruction.
      var prefix = parts[0].split(".");

      for (i = 0; i < prefix.length; i++) {
        var comp = prefix[i];

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
        this.report("'" + this.opcodeString + "' Unhandled component: " + comp);
      }

      for (i = 1; i < parts.length; i++) {
        var comp = parts[i];

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
          this.imm += X86Util.immSize(comp);
          continue;
        }

        this.report("'" + this.opcodeString + "' Unhandled opcode component " + comp + ".");
      }
    }
    else {
      // Parse X86/X64 instruction (including legacy MMX/SSE/3DNOW instructions).
      for (i = 0; i < parts.length; i++) {
        var comp = parts[i];

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
              this.report("'" + this.opcodeString + "' Multiple opcodes, have " + this.opcode + ", found " + comp + ".");
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
          this.imm += X86Util.immSize(comp);
          continue;
        }

        // Parse displacement.
        if (/^(?:cb|cd)$/.test(comp) && !this.rel) {
          this.rel = comp === "cb" ? 1 : 4;
          continue;
        }

        // ERROR.
        this.report("'" + this.opcodeString + "' Unhandled opcode component " + comp + ".");
      }
    }

    // QUIRK: Fix instructions having opcode "01".
    if (this.opcode === "" && this.mm.indexOf("0F01") === this.mm.length - 4) {
      this.opcode = "01";
      this.mm = this.mm.substr(0, this.mm.length - 2);
    }

    if (this.opcode)
      this.opcodeInt = parseInt(this.opcode, 16);

    if (/^\/[0-7]$/.test(this.rm))
      this.rmInt = parseInt(this.rm.substr(1));

    if (!this.opcode)
      this.report("'" + this.opcodeString + "' Couldn't parse instruction's opcode.");
  },

  assignFlags: function(s) {
    // Parse individual flags separated by spaces.
    var flags = s.split(" ");

    for (var i = 0; i < flags.length; i++) {
      var flag = flags[i].trim();
      if (!flag)
        continue;

      var j = flag.indexOf("=");
      if (j !== -1)
        this.assignFlag(flag.substr(0, j), flag.substr(j + 1));
      else
        this.assignFlag(flag, true);
    }
  },

  assignFlag: function(name, value) {
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
          this.report(this.name + ": Invalid privilege level '" + value + "'");

        this.privilege = parseInt(value.substr(1));
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

    this.report(this.name + ": Unhandled flag " + name + "=" + value);
  },

  // Validate the instruction's definition. Common mistakes can be checked and
  // reported easily, however, if the mistake is just an invalid opcode or
  // something else it's impossible to detect.
  validate: function() {
    var isValid = true;
    var immCount = this.getImmCount();

    var m;

    // Verify that the immediate operand/operands are specified in instruction
    // encoding and opcode field. Basically if there is an "ix" in operands,
    // the encoding should contain "I".
    if (immCount > 0) {
      var immEncoding = Utils.repeat("I", immCount);

      // "I" or "II" should be part of the instruction encoding.
      if (this.encoding.indexOf(immEncoding) === -1) {
        isValid = false;
        this.report("Immediate(s) [" + immCount + "] missing in encoding: " + this.encoding);
      }

      // Every immediate should have it's imm byte ("ib", "iw", "id", or "iq")
      // in opcode data.
      m = this.opcodeString.match(/(?:^|\s+)(ib|iw|id|iq)/g);
      if (!m || m.length !== immCount) {
        isValid = false;
        this.report("Immediate(s) [" + immCount + "] not found in opcode: " + this.opcodeString);
      }
    }

    // Verify that AVX/XOP or AVX-512 instruction always specifies L and W fields.
    // FIXME: Not passing, because Intel Manual sometimes doesn't specify W.
    /*
    if (this.isAVX() && (this.l === "" || this.w === "")) {
      this.report("AVX instruction should specify L and W fields:" +
      " L=" + this.l +
      " W=" + this.w + ".");
    }
    */

    // Verify that if the instruction uses the "VVVV" part of VEX/EVEX prefix
    // it has the "NDS/NDD/DDS" part of the "VVVV" definition specified and
    // that the definition matches the opcode encoding.

    return isValid;
  },

  report: function(msg) {
    console.log("[X86Inst:" + this.name + " " + this.operands.join(" ") + "]" + " " + msg);
    this.invalid++;
  }
});

// ============================================================================
// [X86Database]
// ============================================================================

// X86 instruction database - stores X86Inst instances in a map and aggregates
// all instructions with the same name.
var X86Database = Class({
  $construct: function() {
    // Instructions in a map, mapping an instruction name into an array of
    // all instructions defined for that name.
    this.map = {};
    this.sortedNames = null;

    // Instruction statistics.
    this.stats = {
      insts : 0, // Number of all instructions.
      groups: 0, // Number of grouped instructions (having unique name).
      avx   : 0, // Number of AVX instructions.
      xop   : 0, // Number of XOP instructions.
      evex  : 0  // Number of EVEX instructions.
    };
  },

  addInstructions: function(instructions) {
    for (var i = 0; i < instructions.length; i++) {
      var instData = instructions[i];
      var instNames = instData[kIndexName].split("/");

      for (var j = 0; j < instNames.length; j++) {
        var instObj = new X86Inst(
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
  },

  addInstruction: function(inst) {
    var group;

    if (hasOwn.call(this.map, inst.name)) {
      group = this.map[inst.name];
    }
    else {
      group = this.map[inst.name] = [];
      this.sortedNames = null;
      this.stats.groups++;
    }

    group.push(inst);
    this.stats.insts++;

    // Misc stats.
    if (inst.prefix === "VEX" ) this.stats.avx++;
    if (inst.prefix === "XOP" ) this.stats.xop++;
    if (inst.prefix === "EVEX") this.stats.evex++;

    return this;
  },

  getSortedNames: function() {
    var map = this.map;
    var names = this.sortedNames;

    if (names === null) {
      names = Object.keys(map);
      names.sort();
      this.sortedNames = names;
    }

    return names;
  },

  forEachGroup: function(cb, thisArg) {
    var map = this.map;
    var names = this.getSortedNames();

    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      cb.call(thisArg, name, map[name]);
    }

    return this;
  },

  forEachInst: function(cb, thisArg) {
    var map = this.map;
    var names = this.getSortedNames();

    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var list = map[name];

      for (var j = 0; j < list.length; j++) {
        cb.call(thisArg, name, list[j]);
      }
    }

    return this;
  },

  print: function() {
    this.forEachInst(function(name, inst) {
      console.log(inst.name + " " + inst.operands.join(", ") + " " + inst.opcodeString + " [" + inst.opcode + "]");
    }, this);
  }
});

// ============================================================================
// [X86TableGen]
// ============================================================================

var Patterns = {
  "X86Jcc": [{
    match: [{ signature: "=ANY D:rel8"                        , extract: "mm0=@mm;op0=@opcodeInt;rm0=@rmInt" },
            { signature: "=ANY D:rel32"                       , extract: "mm1=@mm;op1=@opcodeInt;rm1=@rmInt" }],
    table: {
    }
  }],

  "Mm3dNow": [{
    match: [{ signature: "=ANY 3DNOW RM:mm,mm/m"              , extract: "mm0=@mm;op0=@opcodeInt;rm0=@rmInt" }],
    table: {
    }
  }]
};

// X86 assembler data generator, used to generate all AsmJit tables which are
// then injected to some .cpp and .h files.
var X86TableGen = Class({
  $construct: function(db, special) {
    this.db = db;
  },

  extractTo: function(result, inst, extract) {
    var arr = extract.split(";");
    for (var i = 0; i < arr.length; i++) {
      var data = arr[i].trim();
      if (!data) continue;

      var parts = data.split("=");
      if (parts.length !== 2)
        throw new Error("Extraction failed: Invalid extract data '" + data + "'");

      var key = parts[0];
      var val = (new Function("return " + parts[1].replace(/\@/g, "this."))).call(inst);
      
      if (hasOwn.call(result, key) && result[key] !== val)
        throw new Error("Extraction failed: Key '" + key + "' already contains '" + result[key] + "', which doesn't match '" + val + "'");

      result[key] = val;
    }
  },

  matchInternal: function(encType, instList, patternList) {
    for (var j = 0; j < patternList.length; j++) {
      var pattern = patternList[j];
      var result = { enc: encType };
      var nMatches = 0;

      var match = pattern.match;
      var matched = false;

      for (var a = 0; a < match.length; a++) {
        var signature = match[a].signature;
        var command = signature.charAt(0);

        signature = signature.substr(1);

        for (var i = 0; i < instList.length; i++) {
          var inst = instList[i];
          if (inst.getSignature() === signature) {
            this.extractTo(result, inst, match[a].extract);
            matched = true;
            nMatches++;
            break;
          }
        }

        if (!matched && command === "=")
          return null;
      }
    }

    if (nMatches !== instList.length)
      return null;

    return result;
  },
  
  match: function(instList) {
    for (var encType in Patterns) {
      var patternList = Patterns[encType];
      var result = this.matchInternal(encType, instList, patternList);

      if (result) {
        console.log(JSON.stringify(result));
        return result;
      }
    }

    return null;
  },

  generate: function() {
    var unmatched = [];

    this.db.forEachGroup(function(name, instList) {
      var result = this.match(instList);
      if (result) {
      }
      else {
        unmatched.push(instList);
      }
    }, this);

    var opMap = {};
    var snMap = {};
    
    unmatched.forEach(function(instList) {
      var signList = [];
      var name = instList[0].name;

      for (var i = 0; i < instList.length; i++) {
        var inst = instList[i];
        var sign = inst.getSignature();

        if (!hasOwn.call(opMap, sign)) {
          opMap[sign] = [];
        }
        opMap[sign].push(name);

        signList.push({
          inst: inst,
          sign: sign
        });
      }

      signList.sort(function(a, b) {
        return Utils.strcmp(a.sign, b.sign);
      });

      var g = "";
      var gMap = {};

      for (var i = 0; i < signList.length; i++) {
        var sign = signList[i].sign;
        sign = "<" + sign + ">";

        if (hasOwn.call(gMap, sign))
          continue;

        g += sign;
        gMap[sign] = true;
      }

      if (!hasOwn.call(snMap, g)) {
        snMap[g] = [];
      }
      snMap[g].push(name);
    }, this);

    var opMapKeys = Object.keys(opMap);
    var snMapKeys = Object.keys(snMap);

    opMapKeys.sort();
    snMapKeys.sort();

    console.log("INSTRUCTIONS [" + snMapKeys.length + "]:");
    for (var i = 0; i < snMapKeys.length; i++) {
      var k = snMapKeys[i];

      console.log("  " + snMap[k].join(" ") + ":");
      var s = k.split("><");
      s[0] = s[0].substr(1);
      s[s.length - 1] = s[s.length - 1].substr(0, s[s.length - 1].length - 1);

      // console.log("  " + k);
      for (var j = 0; j < s.length; j++)
        console.log('  { signature: ' + Utils.padRight(JSON.stringify(s[j]), 36) + ', extract: "op0=@opcodeInt;rm0=@rmValue" },');

      console.log("");
    }
/*
    for (var i = 0; i < snMapKeys.length; i++) {
      var k = snMapKeys[i];
      console.log("  " + k);
      console.log("  " + snMap[k].join(" "));
      console.log("");
    }

    console.log("OPERANDS [" + opMapKeys.length + "]:");
    for (var i = 0; i < opMapKeys.length; i++) {
      var k = opMapKeys[i];
      console.log("  " + k);
      console.log("  " + opMap[k].join(" "));
      console.log("");
    }

    console.log("");
    console.log("===========================================================");
    console.log("");
*/
  }
});

// ============================================================================
// [main]
// ============================================================================

function main(x86db) {
  var db = new X86Database().addInstructions(x86db.instructions);
  var tg = new X86TableGen(db);

  tg.generate();
}

main(x86db);

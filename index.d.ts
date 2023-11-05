declare module "asmdb" {
    export namespace base {
        type KVMap<T> = {
            [k: string]: T;
        }
        interface Attribute {
            name: string;
            type: "string" | "flag";
            doc: string;
        }
        interface Extension {
            name: string;
            from: string;
        }
        interface Shortcut {
            name: string;
            expand: string;
            doc: string;
        }
        interface SpecialReg {
            name: string;
            group: string;
            doc: string;
        }
        interface Name{
            name: string;
        }
        interface Register{
            kind: string;
            any: string;
            names: Array<string>;
        }
        class Instruction<OperandType = Operand> {
            arch: string;
            attributes: { [key: string]: string };
            commutative: number;
            encoding: string;
            extensions: { [key: string]: string };
            fields: { [key: string]: string };
            implicit: number;
            name: string;
            opcodeString: string;
            opcodeValue: number;
            operands: OperandType[];
            operations: { [key: string]: string };
            priviledge: string;
            specialRegs: { [key: string]: string };
            db: any;
            isAlias(): boolean;
            isCommutative(): boolean;
            hasImplicit(): boolean;
            hasAttribute(name: string, matchValue: string): boolean;
            report(msg: string): void;
            toString(): string;
        }
        class Operand {
            data: any;
            flags: number;
            imm: number;
            immSign: string;
            mem: string;
            memSize: number;
            read: boolean;
            reg: string;
            regType: string;
            rel: number;
            restrict: string;
            rwxIndex: number;
            rwxWidth: number;
            type: string;
            write: boolean;
            commutative: boolean;
            implicit: boolean;
            optional: boolean;
            zext: boolean;
            toString(): string;
            isReg(): boolean;
            isMem(): boolean;
            isImm(): boolean;
            isRel(): boolean;
            isRegMem(): boolean;
            isRegOrMem(): boolean;
            isRegList(): boolean;
            isPartialOp(): boolean;
        }
        class ISA<InstructionType = Instruction, SpecialRegType = SpecialReg>{
            stats: { insts: number, groups: number };
            aliases: KVMap<string>;
            attributes: KVMap<Attribute>;
            cpuLevels: any;
            extensions: KVMap<Extension>;
            instructionMap: KVMap<InstructionGroup>;
            instructionNames: string[];
            instructions: Array<InstructionType>;
            shortcuts: KVMap<Shortcut>;
            specialRegs: KVMap<SpecialRegType>;
            //AddData(data: any): void;
            forEachGroup(cb: (name: string, insts: InstructionGroup<InstructionType>) => any): void;
            query(arg: string, copy?: boolean): InstructionGroup<InstructionType>;
            query(args: string[], copy?: boolean): InstructionGroup<InstructionType>;

        }

        enum OperandFlags {
            Commutative = 4,
            Implicit = 2,
            Optional = 1,
            ReadAccess = 16,
            WriteAccess = 32,
            ZExt = 8
        }
        class InstructionGroup<T = Instruction> extends Array<T>{
            checkAttribute(name: string, value: string): number;
        }
    }
    export namespace arm {
        class ISA extends base.ISA<Instruction> { }
        class Instruction extends base.Instruction<Operand> {
            operandByName(name: string): Operand;
         }
        class Operand extends base.Operand { 
            name: string;
            scale: number;
        }
        class Utils{
            static parseShiftOp(s: string): string;
            static parseDtArray(s: string): Array<any> 
            static checkDtSize(x : number): number;
        }

    }
    export namespace armdata {
        const architectures: string[];
        const attributes: base.Attribute[];
        const cpuLevels: base.Name[];
        const extensions: base.Extension[];
        type Instruction = [string,string,string,string,string];
        const instructions: Instruction[];
        const registers: base.KVMap<base.Register>;
        const shortcuts: Array<base.Shortcut>
        const specialRegs: Array<base.SpecialReg>
    }
    export namespace x86 {
        class ISA extends base.ISA<Instruction> { }
        class Instruction extends base.Instruction<Operand> {
            isAVX(): boolean;
            isVEX(): boolean;
            isEVEX(): boolean;
            getWValue(): 0 | 1 | -1;
            signature: string;
            immCount: number;
        }
        class Operand extends base.Operand {
            isFixedReg(): boolean;
            isFixedMem(): boolean;
            isPartialOp(): boolean;
            toRegMem(): string;
            toString(): string;
            regsize: number;
        }
        class Utils {
            /**
            * Split the operand(s) string into individual operands as defined by the
            * instruction database.
            *
            * NOTE: X86/X64 doesn't require anything else than separating the commas,
            * this function is here for compatibility with other instruction sets.
            */
            static splitOperands(s: string): string[];
            /** Get whether the string `s` describes a register operand. */
            static isRegOp(s: string): boolean;
            /** Get whether the string `s` describes a memory operand. */
            static isMemOp(s: string): boolean;
            /** Get whether the string `s` describes an immediate operand. */
            static isImmOp(s: string): boolean;
            /** Get whether the string `s` describes a relative displacement (label). */
            static isRelOp(s: string): boolean;
            /** Get a register type of a `s`, returns `null` if the register is unknown. */
            static regTypeOf(s: string): number | null;
            /** Get a register kind of a `s`, returns `null` if the register is unknown. */
            static regKindOf(s: string): number | null;
            /**
             * Get a register type of a `s`, returns `null` if the register is unknown and `-1`
             * if the given string does only represent a register type, but not a specific reg.
             */
            static regIndexOf(s: string): number | null;
            /** Get size of `s` register in bits */
            static regSize(s: string): number;
            /**
             * Get size of an immediate `s` [in bits].
             * Handles "ib", "iw", "id", "iq", and also "/is4".
             */
            static immSize(s: string): number;
            /** Get size of a relative displacement [in bits]. */
            static relSize(s: string): number;

        }
    }
    export namespace x86data {
        const architectures: string[];
        const attributes: base.Attribute[];
        const cpuLevels: base.Name[];
        const extensions: base.Extension[];
        type Instruction = [string,string,string,string,string];
        const instructions: Instruction[];
        const registers: base.KVMap<base.Register>;
        const shortcuts: Array<base.Shortcut>
        const specialRegs: Array<base.SpecialReg>

    }

}
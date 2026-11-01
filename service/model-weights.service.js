'use strict';

/**
 * What a model's weights say about themselves (#321).
 *
 * An Ultralytics `.pt` is a zip written by `torch.save`, holding a pickle (`data.pkl`) of a
 * dict whose `model` is the network. The network object carries its class names, the YAML
 * it was built from (`yolov8m.yaml`, `yolo11m-cls.yaml`) and its own class
 * (`DetectionModel`, `ClassificationModel`) -- which is the architecture, the task and the
 * engine, read from the file rather than from whatever somebody typed when registering it.
 *
 * **Read without Python and without torch.** The API is Node and must not need either, so
 * this reads the one zip entry it wants (torch stores entries uncompressed, so a 273 MB
 * file is read for its 250 KB pickle) and runs the pickle's opcodes far enough to build
 * plain values. Classes and tensors are never constructed: a class becomes the name it was
 * pickled under, and a tensor becomes a placeholder. Nothing in the file is executed.
 *
 * @module service/model-weights
 */

const fs = require('fs');
const zlib = require('zlib');

/** A class the pickle named: kept as its dotted name, never imported or called. */
class PickledGlobal {
    constructor(name) { this.name = name; }
}

/** An instance of a pickled class: its class name, constructor args and state. */
class PickledObject {
    constructor(cls, args) {
        this.cls = cls;
        this.args = args;
        this.state = null;
    }
}

/** Torch's storage reference, which this never loads. */
const PERSISTENT = Object.freeze({ persistent: true });

/** Python's `None`. */
const NONE = null;

/**
 * Read `length` bytes at `position` from an open file.
 *
 * @param {number} fd - File descriptor.
 * @param {number} position - Byte offset.
 * @param {number} length - Bytes to read.
 * @returns {Buffer} What was read.
 */
function readAt(fd, position, length) {
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(fd, buffer, 0, length, position);
    return buffer.subarray(0, read);
}

/**
 * One entry of a zip, by the end of its name, without reading the rest of the file.
 *
 * Reads the end-of-central-directory record, ZIP64 when torch wrote one, walks the central
 * directory to the entry, and reads its data. Stored and deflated entries both work.
 *
 * @param {string} path - The zip.
 * @param {string} suffix - The end of the entry's name, e.g. `/data.pkl`.
 * @returns {?Buffer} The entry's bytes, or null when there is no such entry.
 * @throws {Error} When the file is not a zip.
 */
function readZipEntry(path, suffix) {
    const fd = fs.openSync(path, 'r');

    try {
        const size = fs.fstatSync(fd).size;
        const tailLength = Math.min(size, 65557 + 20);
        const tail = readAt(fd, size - tailLength, tailLength);
        const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));

        if (eocd < 0) throw new Error('not a zip: no end of central directory');

        let entries = tail.readUInt16LE(eocd + 10);
        let directorySize = tail.readUInt32LE(eocd + 12);
        let directoryOffset = tail.readUInt32LE(eocd + 16);

        // ZIP64: the classic record says 0xFFFFFFFF and the real numbers are elsewhere.
        const locator = eocd - 20;
        if (locator >= 0 && tail.readUInt32LE(locator) === 0x07064b50) {
            const record = readAt(fd, Number(tail.readBigUInt64LE(locator + 8)), 56);
            entries = Number(record.readBigUInt64LE(32));
            directorySize = Number(record.readBigUInt64LE(40));
            directoryOffset = Number(record.readBigUInt64LE(48));
        }

        const directory = readAt(fd, directoryOffset, directorySize);
        let at = 0;

        for (let index = 0; index < entries && at + 46 <= directory.length; index += 1) {
            const method = directory.readUInt16LE(at + 10);
            let compressed = directory.readUInt32LE(at + 20);
            let uncompressed = directory.readUInt32LE(at + 24);
            const nameLength = directory.readUInt16LE(at + 28);
            const extraLength = directory.readUInt16LE(at + 30);
            const commentLength = directory.readUInt16LE(at + 32);
            let localOffset = directory.readUInt32LE(at + 42);
            const name = directory.toString('utf8', at + 46, at + 46 + nameLength);

            if (name.endsWith(suffix)) {
                // ZIP64 extra field: the 0xFFFFFFFF values, in order.
                let extra = at + 46 + nameLength;
                const extraEnd = extra + extraLength;
                while (extra + 4 <= extraEnd) {
                    const id = directory.readUInt16LE(extra);
                    const length = directory.readUInt16LE(extra + 2);
                    if (id === 0x0001) {
                        let field = extra + 4;
                        if (uncompressed === 0xffffffff) { uncompressed = Number(directory.readBigUInt64LE(field)); field += 8; }
                        if (compressed === 0xffffffff) { compressed = Number(directory.readBigUInt64LE(field)); field += 8; }
                        if (localOffset === 0xffffffff) { localOffset = Number(directory.readBigUInt64LE(field)); }
                    }
                    extra += 4 + length;
                }

                const local = readAt(fd, localOffset, 30);
                const start = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
                const data = readAt(fd, start, compressed);

                if (method === 0) return data;
                if (method === 8) return zlib.inflateRawSync(data);
                throw new Error(`zip entry ${name} uses compression method ${method}`);
            }

            at += 46 + nameLength + extraLength + commentLength;
        }

        return null;
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * Run a pickle's opcodes into plain values.
 *
 * Dicts become `Map`s (their keys may be integers), lists arrays, tuples arrays, a class a
 * `PickledGlobal`, an instance a `PickledObject`. Nothing is imported or executed.
 *
 * @param {Buffer} data - The pickle.
 * @returns {*} The top-level value.
 * @throws {Error} On an opcode this does not read.
 */
function unpickle(data) {
    const stack = [];
    const marks = [];
    const memo = new Map();
    let at = 0;

    const popMark = () => {
        const from = marks.pop();
        return stack.splice(from, stack.length - from);
    };
    const u8 = () => data[at++];
    const u16 = () => { const v = data.readUInt16LE(at); at += 2; return v; };
    const u32 = () => { const v = data.readUInt32LE(at); at += 4; return v; };
    const i32 = () => { const v = data.readInt32LE(at); at += 4; return v; };
    const u64 = () => { const v = Number(data.readBigUInt64LE(at)); at += 8; return v; };
    const bytes = (n) => { const v = data.subarray(at, at + n); at += n; return v; };
    const line = () => { const end = data.indexOf(0x0a, at); const v = data.toString('utf8', at, end); at = end + 1; return v; };
    const longBytes = (raw) => {
        if (!raw.length) return 0;
        let value = 0n;
        for (let i = raw.length - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(raw[i]);
        if (raw[raw.length - 1] & 0x80) value -= 1n << BigInt(raw.length * 8);
        return Number(value);
    };
    const setItems = (target, items) => {
        for (let i = 0; i + 1 < items.length; i += 2) {
            if (target instanceof Map) target.set(items[i], items[i + 1]);
        }
    };
    const reduce = (callable, args) => {
        const name = callable instanceof PickledGlobal ? callable.name : '';
        if (name === 'collections.OrderedDict') return new Map();
        if (name.startsWith('torch._utils._rebuild')) return PERSISTENT;
        return new PickledObject(name, args);
    };

    for (;;) {
        const op = data[at++];

        switch (op) {
        case 0x80: at += 1; break; // PROTO
        case 0x95: at += 8; break; // FRAME
        case 0x2e: return stack.pop(); // STOP
        case 0x28: marks.push(stack.length); break; // MARK
        case 0x4e: stack.push(NONE); break; // NONE
        case 0x88: stack.push(true); break; // NEWTRUE
        case 0x89: stack.push(false); break; // NEWFALSE
        case 0x4b: stack.push(u8()); break; // BININT1
        case 0x4d: stack.push(u16()); break; // BININT2
        case 0x4a: stack.push(i32()); break; // BININT
        case 0x8a: stack.push(longBytes(bytes(u8()))); break; // LONG1
        case 0x8b: stack.push(longBytes(bytes(u32()))); break; // LONG4
        case 0x47: stack.push(data.readDoubleBE(at)); at += 8; break; // BINFLOAT
        case 0x49: { const v = line(); stack.push(v === '01' ? true : v === '00' ? false : Number(v)); break; } // INT
        case 0x4c: stack.push(Number(line().replace(/L$/, ''))); break; // LONG
        case 0x46: stack.push(Number(line())); break; // FLOAT
        case 0x8c: stack.push(bytes(u8()).toString('utf8')); break; // SHORT_BINUNICODE
        case 0x58: stack.push(bytes(u32()).toString('utf8')); break; // BINUNICODE
        case 0x8d: stack.push(bytes(u64()).toString('utf8')); break; // BINUNICODE8
        case 0x55: stack.push(bytes(u8()).toString('latin1')); break; // SHORT_BINSTRING
        case 0x54: stack.push(bytes(u32()).toString('latin1')); break; // BINSTRING
        case 0x43: stack.push(bytes(u8())); break; // SHORT_BINBYTES
        case 0x42: stack.push(bytes(u32())); break; // BINBYTES
        case 0x8e: stack.push(bytes(u64())); break; // BINBYTES8
        case 0x56: stack.push(line()); break; // UNICODE
        case 0x53: stack.push(line().replace(/^'|'$/g, '')); break; // STRING
        case 0x7d: stack.push(new Map()); break; // EMPTY_DICT
        case 0x5d: stack.push([]); break; // EMPTY_LIST
        case 0x29: stack.push([]); break; // EMPTY_TUPLE
        case 0x8f: stack.push([]); break; // EMPTY_SET
        case 0x85: stack.push([stack.pop()]); break; // TUPLE1
        case 0x86: { const b = stack.pop(); const a = stack.pop(); stack.push([a, b]); break; } // TUPLE2
        case 0x87: { const c = stack.pop(); const b = stack.pop(); const a = stack.pop(); stack.push([a, b, c]); break; } // TUPLE3
        case 0x74: stack.push(popMark()); break; // TUPLE
        case 0x6c: stack.push(popMark()); break; // LIST
        case 0x91: stack.push(popMark()); break; // FROZENSET
        case 0x64: { const items = popMark(); const d = new Map(); setItems(d, items); stack.push(d); break; } // DICT
        case 0x73: { const v = stack.pop(); const k = stack.pop(); const d = stack[stack.length - 1]; if (d instanceof Map) d.set(k, v); break; } // SETITEM
        case 0x75: { const items = popMark(); setItems(stack[stack.length - 1], items); break; } // SETITEMS
        case 0x61: { const v = stack.pop(); const l = stack[stack.length - 1]; if (Array.isArray(l)) l.push(v); break; } // APPEND
        case 0x65: { const items = popMark(); const l = stack[stack.length - 1]; if (Array.isArray(l)) l.push(...items); break; } // APPENDS
        case 0x90: { const items = popMark(); const s = stack[stack.length - 1]; if (Array.isArray(s)) s.push(...items); break; } // ADDITEMS
        case 0x71: memo.set(u8(), stack[stack.length - 1]); break; // BINPUT
        case 0x72: memo.set(u32(), stack[stack.length - 1]); break; // LONG_BINPUT
        case 0x70: memo.set(Number(line()), stack[stack.length - 1]); break; // PUT
        case 0x94: memo.set(memo.size, stack[stack.length - 1]); break; // MEMOIZE
        case 0x68: stack.push(memo.get(u8())); break; // BINGET
        case 0x6a: stack.push(memo.get(u32())); break; // LONG_BINGET
        case 0x67: stack.push(memo.get(Number(line()))); break; // GET
        case 0x63: { const module = line(); const name = line(); stack.push(new PickledGlobal(`${module}.${name}`)); break; } // GLOBAL
        case 0x93: { const name = stack.pop(); const module = stack.pop(); stack.push(new PickledGlobal(`${module}.${name}`)); break; } // STACK_GLOBAL
        case 0x52: { const args = stack.pop(); const callable = stack.pop(); stack.push(reduce(callable, args)); break; } // REDUCE
        case 0x81: { const args = stack.pop(); const cls = stack.pop(); stack.push(new PickledObject(cls instanceof PickledGlobal ? cls.name : '', args)); break; } // NEWOBJ
        case 0x92: { stack.pop(); const args = stack.pop(); const cls = stack.pop(); stack.push(new PickledObject(cls instanceof PickledGlobal ? cls.name : '', args)); break; } // NEWOBJ_EX
        case 0x62: { const state = stack.pop(); const target = stack[stack.length - 1]; if (target instanceof PickledObject) target.state = state; break; } // BUILD
        case 0x51: stack.pop(); stack.push(PERSISTENT); break; // BINPERSID
        case 0x50: line(); stack.push(PERSISTENT); break; // PERSID
        case 0x30: stack.pop(); break; // POP
        case 0x31: popMark(); break; // POP_MARK
        case 0x32: stack.push(stack[stack.length - 1]); break; // DUP
        default:
            throw new Error(`pickle opcode 0x${(op ?? 0).toString(16)} at byte ${at - 1} is not one this reads`);
        }
    }
}

/** A pickled object's attribute: its state is a dict, or a (dict, slots) pair. */
function attribute(object, name) {
    if (!(object instanceof PickledObject)) return undefined;
    const state = Array.isArray(object.state) ? object.state[0] : object.state;
    return state instanceof Map ? state.get(name) : undefined;
}

/** What each Ultralytics model class is for, as MARP names the task. */
const TASKS = {
    DetectionModel: 'detection',
    ClassificationModel: 'classification',
    SegmentationModel: 'segmentation',
    PoseModel: 'pose',
    OBBModel: 'obb',
    WorldModel: 'detection',
    RTDETRDetectionModel: 'detection',
};

/**
 * Each generation's sizes, by the depth and width multiples its YAML scales by.
 * From Ultralytics' own `yolov8.yaml` and `yolo11.yaml`.
 */
const SCALES = {
    yolov8: { n: [0.33, 0.25], s: [0.33, 0.5], m: [0.67, 0.75], l: [1.0, 1.0], x: [1.0, 1.25] },
    yolo11: { n: [0.5, 0.25], s: [0.5, 0.5], m: [0.5, 1.0], l: [1.0, 1.0], x: [1.0, 1.5] },
};

/** The task suffix Ultralytics gives an architecture name. */
const SUFFIX = { classification: '-cls', segmentation: '-seg', pose: '-pose', obb: '-obb' };

/**
 * The architecture of a checkpoint whose YAML does not name its file.
 *
 * Older checkpoints carry the YAML's contents and not its name, so it is recognised: the
 * backbone's blocks give the generation (`C3k2` is YOLO11, `C2f` YOLOv8) and the depth and
 * width multiples give the size.
 *
 * @param {Map} yaml - The model's `yaml` attribute.
 * @param {?string} task - The task, for the name's suffix.
 * @returns {?string} e.g. `yolov8x`, or null when it is not one of these.
 */
function recogniseArchitecture(yaml, task) {
    const blocks = JSON.stringify([...(yaml.get('backbone') || []), ...(yaml.get('head') || [])]);
    const generation = blocks.includes('"C3k2"') ? 'yolo11' : blocks.includes('"C2f"') ? 'yolov8' : null;
    const depth = Number(yaml.get('depth_multiple'));
    const width = Number(yaml.get('width_multiple'));

    if (!generation) return null;

    const size = Object.entries(SCALES[generation])
        .find(([, [d, w]]) => Math.abs(d - depth) < 0.01 && Math.abs(w - width) < 0.01);

    return size ? `${generation}${size[0]}${SUFFIX[task] || ''}` : null;
}

/**
 * What a weights file says it is.
 *
 * @param {string} path - A `.pt` on disk.
 * @returns {{engine: ?string, architecture: ?string, task: ?string, file_format: string,
 *   class_names: string[], model_class: ?string}} What could be read; null where it could not.
 * @throws {Error} When the file is not a torch zip or its pickle cannot be read.
 */
function describeWeights(path) {
    const pickle = readZipEntry(path, '/data.pkl');
    if (!pickle) throw new Error('not a torch checkpoint: no data.pkl inside');

    const checkpoint = unpickle(pickle);
    const holder = checkpoint instanceof Map ? checkpoint : new Map();
    const model = [holder.get('model'), holder.get('ema')].find((one) => one instanceof PickledObject) || null;

    const modelClass = model ? model.cls : null;
    const shortClass = modelClass ? modelClass.split('.').pop() : null;
    const yaml = model ? attribute(model, 'yaml') : undefined;
    const yamlFile = yaml instanceof Map ? yaml.get('yaml_file') : undefined;

    // `names` is a dict of index to name, or (older) a list.
    const rawNames = model ? attribute(model, 'names') : undefined;
    let classNames = [];
    if (rawNames instanceof Map) {
        classNames = [...rawNames.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([, name]) => String(name));
    } else if (Array.isArray(rawNames)) {
        classNames = rawNames.map(String);
    }

    const task = TASKS[shortClass] || null;
    const named = typeof yamlFile === 'string' ? yamlFile.replace(/^.*[\\/]/, '').replace(/\.ya?ml$/i, '') : null;

    return {
        engine: modelClass && modelClass.startsWith('ultralytics.') ? 'ultralytics' : null,
        architecture: named || (yaml instanceof Map ? recogniseArchitecture(yaml, task) : null),
        task,
        file_format: 'pt',
        class_names: classNames,
        model_class: modelClass,
    };
}

module.exports = { describeWeights, readZipEntry, unpickle };

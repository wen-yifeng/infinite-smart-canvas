/**
 * ZIP archive utilities for canvas export.
 *
 * Extracted from canvas-list.js to keep the home page focused on UI
 * orchestration. Exposes a single createZipBlob() entry point plus
 * the resource-collection helpers that exportCanvasWithResources uses.
 */
(function () {
    'use strict';

    const ZIP_ENCODER = new TextEncoder();
    let ZIP_CRC_TABLE = null;

    function safeExportBase(name, fallback) {
        fallback = fallback || 'canvas';
        return String(name || fallback).replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 60) || fallback;
    }

    function isCanvasResourceUrl(url) {
        return url.startsWith('/assets/') || url.startsWith('/output/') || /^https?:\/\//i.test(url);
    }

    function collectCanvasResourceUrls(value, out, seen) {
        out = out || [];
        seen = seen || new Set();
        if (value == null) return out;
        if (typeof value === 'string') {
            var text = value.trim();
            if (isCanvasResourceUrl(text) && !seen.has(text)) {
                seen.add(text);
                out.push(text);
            }
            return out;
        }
        if (Array.isArray(value)) {
            value.forEach(function (item) { collectCanvasResourceUrls(item, out, seen); });
            return out;
        }
        if (typeof value === 'object') {
            Object.values(value).forEach(function (item) { collectCanvasResourceUrls(item, out, seen); });
        }
        return out;
    }

    function exportResourceName(url, index, used) {
        var name = '';
        try {
            var parsed = new URL(url, location.origin);
            name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
        } catch (e) {
            name = String(url || '').split(/[?#]/)[0].split('/').pop() || '';
        }
        name = safeExportBase(name || 'resource-' + String(index + 1).padStart(3, '0'), 'resource-' + (index + 1));
        if (!/\.[a-z0-9]{1,8}$/i.test(name)) name += '.bin';
        var finalName = 'resources/' + name;
        var dot = finalName.lastIndexOf('.');
        var stem = dot > 0 ? finalName.slice(0, dot) : finalName;
        var ext = dot > 0 ? finalName.slice(dot) : '';
        var suffix = 2;
        while (used.has(finalName)) {
            finalName = stem + '-' + suffix + ext;
            suffix++;
        }
        used.add(finalName);
        return finalName;
    }

    async function fetchResourceBytes(url) {
        var res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return new Uint8Array(await res.arrayBuffer());
    }

    function zipCrc32(bytes) {
        if (!ZIP_CRC_TABLE) {
            ZIP_CRC_TABLE = new Uint32Array(256);
            for (var i = 0; i < 256; i++) {
                var c = i;
                for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
                ZIP_CRC_TABLE[i] = c >>> 0;
            }
        }
        var crc = 0xffffffff;
        for (var i = 0; i < bytes.length; i++) crc = ZIP_CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
    }

    function zipDosTime(date) {
        date = date || new Date();
        var time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
        var year = Math.max(1980, date.getFullYear());
        var day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
        return { time: time, day: day };
    }

    function zipHeader(signature, size) {
        var bytes = new Uint8Array(size);
        var view = new DataView(bytes.buffer);
        view.setUint32(0, signature, true);
        return { bytes: bytes, view: view };
    }

    function createZipBlob(entries) {
        var now = zipDosTime();
        var files = [];
        var central = [];
        var offset = 0;
        entries.forEach(function (entry) {
            var nameBytes = ZIP_ENCODER.encode(entry.name);
            var data = entry.bytes instanceof Uint8Array ? entry.bytes : ZIP_ENCODER.encode(String(entry.bytes || ''));
            var crc = zipCrc32(data);
            var local = zipHeader(0x04034b50, 30 + nameBytes.length);
            local.view.setUint16(4, 20, true);
            local.view.setUint16(6, 0x0800, true);
            local.view.setUint16(8, 0, true);
            local.view.setUint16(10, now.time, true);
            local.view.setUint16(12, now.day, true);
            local.view.setUint32(14, crc, true);
            local.view.setUint32(18, data.length, true);
            local.view.setUint32(22, data.length, true);
            local.view.setUint16(26, nameBytes.length, true);
            local.bytes.set(nameBytes, 30);
            files.push(local.bytes, data);
            var cd = zipHeader(0x02014b50, 46 + nameBytes.length);
            cd.view.setUint16(4, 20, true);
            cd.view.setUint16(6, 20, true);
            cd.view.setUint16(8, 0x0800, true);
            cd.view.setUint16(10, 0, true);
            cd.view.setUint16(12, now.time, true);
            cd.view.setUint16(14, now.day, true);
            cd.view.setUint32(16, crc, true);
            cd.view.setUint32(20, data.length, true);
            cd.view.setUint32(24, data.length, true);
            cd.view.setUint16(28, nameBytes.length, true);
            cd.view.setUint32(42, offset, true);
            cd.bytes.set(nameBytes, 46);
            central.push(cd.bytes);
            offset += local.bytes.length + data.length;
        });
        var centralSize = central.reduce(function (sum, bytes) { return sum + bytes.length; }, 0);
        var end = zipHeader(0x06054b50, 22);
        end.view.setUint16(8, entries.length, true);
        end.view.setUint16(10, entries.length, true);
        end.view.setUint32(12, centralSize, true);
        end.view.setUint32(16, offset, true);
        return new Blob([].concat(files, central, [end.bytes]), { type: 'application/zip' });
    }

    /* ---- export ---- */
    window.SmartCanvasZipUtils = {
        safeExportBase: safeExportBase,
        collectCanvasResourceUrls: collectCanvasResourceUrls,
        exportResourceName: exportResourceName,
        fetchResourceBytes: fetchResourceBytes,
        createZipBlob: createZipBlob
    };
})();
/**
 * Make a self-signed TLS certificate for a development server reached by IP address.
 *
 * A browser only gives a page the WebCodecs decoder on a secure address, so the Mosaic's
 * video page needs HTTPS (#181). With no domain there is no certificate a browser already
 * trusts: this makes one for the addresses given, which a browser warns about once and
 * then serves as secure. Installing `cert.pem` as trusted on a reviewer's machine stops
 * the warning.
 *
 * Writes `key.pem` and `cert.pem` into the git-ignored `.marp/local/tls/` and prints the
 * two `.env` lines that make `server.js` serve HTTPS beside HTTP on the same port. Refuses
 * to replace a pair that exists unless given `--force`.
 *
 * Usage:
 *   node scripts/create-dev-tls-certificate.js --ip 47.208.203.78 [--ip 192.168.1.33] [--force]
 *
 * @fileoverview Self-signed development certificate for an IP address.
 * @author Isaac Travers
 * @module scripts/create-dev-tls-certificate
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/** Where the pair goes: git-ignored, like every other machine-local file. */
const DIRECTORY = path.join(__dirname, '..', '.marp', 'local', 'tls');

/** Long enough not to lapse mid-project; the most a browser accepts for a leaf. */
const DAYS = 825;

function argumentValues(name) {
    const values = [];
    process.argv.forEach((argument, index) => {
        if (argument === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
    });
    return values;
}

function main() {
    const ips = argumentValues('--ip');

    if (ips.length === 0) {
        console.error('Give the address the server is reached at: --ip 47.208.203.78 (repeat for more).');
        process.exit(2);
    }

    const key = path.join(DIRECTORY, 'key.pem');
    const cert = path.join(DIRECTORY, 'cert.pem');

    if (fs.existsSync(cert) && !process.argv.includes('--force')) {
        console.error(`${cert} exists. Pass --force to replace it; every browser that accepted the old one will warn again.`);
        process.exit(1);
    }

    fs.mkdirSync(DIRECTORY, { recursive: true });

    // localhost as well, so the same pair serves a browser on this machine.
    const names = [...ips.map((ip) => `IP:${ip}`), 'IP:127.0.0.1', 'DNS:localhost'];
    const made = spawnSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256',
        '-keyout', key, '-out', cert, '-days', String(DAYS),
        '-subj', '/CN=MARP development',
        '-addext', `subjectAltName=${names.join(',')}`,
        '-addext', 'extendedKeyUsage=serverAuth',
    ], { encoding: 'utf8' });

    if (made.status !== 0) {
        console.error(`openssl failed: ${made.error ? made.error.message : made.stderr}`);
        process.exit(1);
    }

    console.log(`Made ${cert} for ${names.join(', ')}, valid ${DAYS} days.`);
    console.log('Add these to .env and restart the server:');
    console.log(`  HTTPS_KEY_PATH=${key}`);
    console.log(`  HTTPS_CERT_PATH=${cert}`);
}

main();

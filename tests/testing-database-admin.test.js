/**
 * A known weak credential only ever reaches a throwaway database.
 *
 * `scripts/testing-database.js` ends every `up` with a login of `isaac`/`isaac`
 * holding every permission, because `marp agent start` creates the bootstrap
 * administrator row and never sets its password -- so there is an account and no
 * way to authenticate as it, and that was being discovered by hand at the moment
 * somebody wanted to look at a running app.
 *
 * That convenience is only acceptable because it cannot happen anywhere else, and
 * **"cannot" is a claim worth watching fire.** `tests/setup/local-database-guard.js`
 * exists for the same reason and says it plainly: the development database carries
 * the same name as production and only the host tells them apart, so a misdirected
 * `.env` is genuinely dangerous rather than theoretically so.
 *
 * `weakCredentialRefusal` is pure and returns the reason rather than exiting, so
 * every case here runs without a database and without a process to kill -- the
 * shape `db/corpus.js` uses for `holdsCorpus`, and for the same reason.
 *
 * No rows are read or written, so nothing needs restoring.
 *
 * @fileoverview The testing database's admin login refuses anywhere real.
 * @module tests/testing-database-admin
 * @author Isaac Travers
 */

'use strict';

const { ADMIN_LOGIN, weakCredentialRefusal } = require('../scripts/testing-database');

/** The database this checkout develops against, in every case below. */
const DEVELOPMENT = 'mare_v1';

/** A target that is not it. */
const DISPOSABLE = { database: 'marp_test' };

describe('the testing database admin login', () => {

    test('it is the lowercase login that was asked for', () => {
        // Pinned because it is the credential a person types, and a change to it
        // is a change to what somebody has been told to use.
        expect(ADMIN_LOGIN.username).toBe('isaac');
        expect(ADMIN_LOGIN.password).toBe('isaac');
    });

    describe('where it may be created', () => {

        test('a second database on this machine is permitted', () => {
            expect(weakCredentialRefusal(DISPOSABLE, DEVELOPMENT, '127.0.0.1')).toBeNull();
            expect(weakCredentialRefusal(DISPOSABLE, DEVELOPMENT, 'localhost')).toBeNull();
        });

        test('a host is read the way the suite guard reads one, trimmed and folded', () => {
            // Not a nicety. `DB_HOST=Localhost ` with a trailing space is a real
            // shape of a hand-edited .env, and refusing it would teach somebody
            // that the guard is broken rather than that they are somewhere real.
            expect(weakCredentialRefusal(DISPOSABLE, DEVELOPMENT, '  LocalHost  ')).toBeNull();
        });

    });

    describe('where it may not', () => {

        test('a host that is not this machine is refused, and named', () => {
            const refusal = weakCredentialRefusal(DISPOSABLE, DEVELOPMENT, '10.0.1.14');

            expect(refusal).toMatch(/10\.0\.1\.14/);
            expect(refusal).toMatch(/not this machine/);
        });

        test('an unset host is refused rather than assumed local', () => {
            // The state a half-written .env leaves behind, and the one case where
            // guessing is worst: nothing says where it would have connected.
            for (const host of ['', '   ', undefined, null]) {
                expect(weakCredentialRefusal(DISPOSABLE, DEVELOPMENT, host)).toMatch(/not set/);
            }
        });

        test('the database this checkout develops against is refused', () => {
            const refusal = weakCredentialRefusal(
                { database: DEVELOPMENT }, DEVELOPMENT, '127.0.0.1'
            );

            expect(refusal).toMatch(/develops against/);
            expect(refusal).toMatch(/not disposable/);
        });

        test('an unnamed target is refused', () => {
            expect(weakCredentialRefusal({}, DEVELOPMENT, '127.0.0.1')).toMatch(/unnamed/);
        });

        test('the suite\'s remote override does not get past it', () => {
            // `MARP_TEST_ALLOW_REMOTE_DB` exists so a refusal nobody can get past
            // does not get deleted the first time it is inconvenient. That is a
            // good reason for the test suite and a bad one here: the whole value
            // of this refusal is that no flag makes a weak password reach a
            // database somewhere else.
            const previous = process.env.MARP_TEST_ALLOW_REMOTE_DB;
            process.env.MARP_TEST_ALLOW_REMOTE_DB = '1';

            try {
                expect(weakCredentialRefusal(DISPOSABLE, DEVELOPMENT, '10.0.1.14'))
                    .toMatch(/not this machine/);
            } finally {
                if (previous === undefined) {
                    delete process.env.MARP_TEST_ALLOW_REMOTE_DB;
                } else {
                    process.env.MARP_TEST_ALLOW_REMOTE_DB = previous;
                }
            }
        });

    });

});

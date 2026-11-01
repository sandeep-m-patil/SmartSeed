import { isValidToken, parseScannedToken } from '../src/domain/token';
import { TOKEN } from './fixtures';

const HOSTS = ['smartseed.example'];
const parse = (s: string) => parseScannedToken(s, HOSTS);

describe('parseScannedToken', () => {
  it('accepts the canonical URL and extracts the token', () => {
    expect(parse(`https://smartseed.example/verify/${TOKEN}`)).toEqual({ ok: true, token: TOKEN });
  });

  it('accepts trailing slash, surrounding whitespace, uppercase host, explicit :443', () => {
    expect(parse(`  https://SmartSeed.Example/verify/${TOKEN}/  `)).toEqual({ ok: true, token: TOKEN });
    expect(parse(`https://smartseed.example:443/verify/${TOKEN}`)).toEqual({ ok: true, token: TOKEN });
  });

  it.each([
    ['http scheme', `http://smartseed.example/verify/${TOKEN}`],
    ['javascript scheme', `javascript:alert(1)//smartseed.example/verify/${TOKEN}`],
    ['other host', `https://evil.example/verify/${TOKEN}`],
    ['suffix look-alike host', `https://smartseed.example.evil.com/verify/${TOKEN}`],
    ['prefix look-alike host', `https://evilsmartseed.example/verify/${TOKEN}`],
    ['userinfo trick', `https://smartseed.example@evil.com/verify/${TOKEN}`],
    ['userinfo trick 2', `https://evil.com@smartseed.example/verify/${TOKEN}`],
    ['other port', `https://smartseed.example:8443/verify/${TOKEN}`],
    ['extra path segment', `https://smartseed.example/verify/${TOKEN}/extra`],
    ['path traversal', 'https://smartseed.example/verify/../admin'],
    ['encoded traversal', 'https://smartseed.example/verify/%2e%2e%2fadmin'],
    ['wrong path', `https://smartseed.example/other/${TOKEN}`],
    ['query string', `https://smartseed.example/verify/${TOKEN}?redirect=https://evil.com`],
    ['fragment', `https://smartseed.example/verify/${TOKEN}#x`],
    ['token too short', 'https://smartseed.example/verify/abc123'],
    ['token with bad chars', 'https://smartseed.example/verify/AbCdEfGhIjKlMnOpQr<script>'],
    ['token too long', `https://smartseed.example/verify/${'a'.repeat(200)}`],
    ['plain text', 'hello world'],
    ['empty string', ''],
    ['bare token', TOKEN],
    ['upi payment QR', 'upi://pay?pa=someone@bank&am=5000'],
    ['newline injection', `https://smartseed.example/verify/${TOKEN}\nhttps://evil.com`],
  ])('rejects %s', (_name, raw) => {
    expect(parse(raw)).toEqual({ ok: false, reason: 'NOT_SMARTSEED' });
  });

  it('honours configured hosts only', () => {
    expect(parseScannedToken(`https://farm.example.org/verify/${TOKEN}`, ['farm.example.org'])).toEqual({ ok: true, token: TOKEN });
    expect(parseScannedToken(`https://smartseed.example/verify/${TOKEN}`, ['farm.example.org']).ok).toBe(false);
  });
});

describe('isValidToken', () => {
  it('validates length and alphabet', () => {
    expect(isValidToken(TOKEN)).toBe(true);
    expect(isValidToken('short')).toBe(false);
    expect(isValidToken(`${TOKEN}/..`)).toBe(false);
  });
});

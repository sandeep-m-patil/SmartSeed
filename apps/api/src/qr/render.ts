import QRCode from 'qrcode';

const QR_MARGIN = 2;
const PNG_WIDTH = 512;

export const verifyUrl = (baseUrl: string, token: string): string => `${baseUrl.replace(/\/$/, '')}/verify/${token}`;

export const renderPng = (url: string): Promise<Buffer> =>
  QRCode.toBuffer(url, { type: 'png', width: PNG_WIDTH, margin: QR_MARGIN, errorCorrectionLevel: 'M' });

export const renderSvg = (url: string): Promise<string> =>
  QRCode.toString(url, { type: 'svg', margin: QR_MARGIN, errorCorrectionLevel: 'M' });

const escapeXml = (s: string): string =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string);

export interface LabelInfo {
  productName: string;
  brand: string;
  batchCode: string;
  expiryDate: string;
  serialNo?: number | undefined;
}

/** Printable 60x40 mm label: QR plus human-readable batch text (no secrets beyond the public token URL). */
export async function renderLabel(url: string, info: LabelInfo): Promise<string> {
  const qrSvg = await renderSvg(url);
  const inner = qrSvg.replace(/<\?xml[^>]*>/, '').replace(/<svg[^>]*>/, '').replace('</svg>', '');
  const viewBox = /viewBox="([^"]+)"/.exec(qrSvg)?.[1] ?? '0 0 33 33';
  const lines = [info.brand, info.productName, `Batch ${info.batchCode}`, `Exp ${info.expiryDate}`];
  if (info.serialNo) lines.push(`Pack #${info.serialNo}`);
  const text = lines
    .map((l, i) => `<text x="38" y="${8 + i * 6}" font-family="Arial, sans-serif" font-size="4">${escapeXml(l)}</text>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40">` +
    `<rect width="60" height="40" fill="#fff"/><svg x="3" y="5" width="32" height="32" viewBox="${viewBox}">${inner}</svg>${text}</svg>`;
}

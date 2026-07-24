import type { AssetDto } from "./types";

type CellValue = string | number | boolean | null;

const encoder = new TextEncoder();

function xml(value: CellValue) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function worksheet(rows: CellValue[][]) {
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) {
        return `<c r="${reference}"><v>${value}</v></c>`;
      }
      if (typeof value === "boolean") {
        return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
      }
      return `<c r="${reference}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function record(size: number, write: (view: DataView) => void) {
  const data = new Uint8Array(size);
  write(new DataView(data.buffer));
  return data;
}

function join(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function createStoredZip(files: Array<{ name: string; contents: string }>) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const contents = encoder.encode(file.contents);
    const crc = crc32(contents);
    const localHeader = record(30, (view) => {
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, contents.byteLength, true);
      view.setUint32(22, contents.byteLength, true);
      view.setUint16(26, name.byteLength, true);
    });
    localParts.push(localHeader, name, contents);

    const centralHeader = record(46, (view) => {
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint32(16, crc, true);
      view.setUint32(20, contents.byteLength, true);
      view.setUint32(24, contents.byteLength, true);
      view.setUint16(28, name.byteLength, true);
      view.setUint32(42, localOffset, true);
    });
    centralParts.push(centralHeader, name);
    localOffset += localHeader.byteLength + name.byteLength + contents.byteLength;
  }
  const central = join(centralParts);
  const end = record(22, (view) => {
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, files.length, true);
    view.setUint16(10, files.length, true);
    view.setUint32(12, central.byteLength, true);
    view.setUint32(16, localOffset, true);
  });
  return join([...localParts, central, end]);
}

function portfolioRows(assets: AssetDto[]) {
  const headers = [
    "ID da aplicação",
    "Classe",
    "Instrumento",
    "Ticker",
    "Nome",
    "Família",
    "Indexação",
    "Nota",
    "Catálogo ID",
    "Tipo personalizado",
    "Emissor",
    "Produto",
    "Quantidade",
    "Preço",
    "Valor investido",
    "Valor atual",
    "Moeda",
    "Fracionado",
    "Formato da taxa",
    "Indexador",
    "Taxa",
    "Data da compra",
    "Vencimento",
  ];
  const rows: CellValue[][] = [headers];
  for (const asset of assets) {
    if (asset.instrumentType !== "FIXED_INCOME") {
      rows.push([
        "",
        asset.investmentClass,
        asset.instrumentType,
        asset.ticker,
        asset.name,
        asset.fixedIncomeFamilyCode ?? "",
        asset.indexation ?? "",
        asset.score,
        "",
        "",
        "",
        "",
        Number(asset.quantity),
        Number(asset.nativeUnitPrice ?? asset.unitPrice),
        "",
        Number(asset.currentValue),
        asset.currency,
        asset.fractional,
        "",
        "",
        "",
        "",
        "",
      ]);
      continue;
    }
    for (const holding of asset.holdings) {
      rows.push([
        holding.id,
        asset.investmentClass,
        asset.instrumentType,
        asset.ticker,
        asset.name,
        asset.fixedIncomeFamilyCode ?? "",
        asset.indexation ?? "",
        asset.score,
        holding.catalogItemId ?? "",
        holding.customTypeName ?? "",
        holding.issuer,
        holding.productName,
        Number(holding.quantity),
        Number(holding.unitPrice),
        holding.investedValue === null ? "" : Number(holding.investedValue),
        Number(holding.currentValue),
        holding.currency,
        holding.fractional,
        holding.rateConvention ?? "",
        holding.benchmark ?? "",
        holding.rateValue === null ? "" : Number(holding.rateValue),
        holding.purchaseDate?.slice(0, 10) ?? "",
        holding.maturityDate?.slice(0, 10) ?? "",
      ]);
    }
  }
  return rows;
}

export function exportPortfolioXlsx(assets: AssetDto[]) {
  const files = [
    {
      name: "[Content_Types].xml",
      contents: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      contents: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      contents: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Carteira" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      contents: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      contents: worksheet(portfolioRows(assets)),
    },
  ];
  const blob = new Blob([createStoredZip(files)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `carteira-${new Date().toISOString().slice(0, 10)}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}

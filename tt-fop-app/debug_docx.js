/**
 * Extract and dump the table structure from the actual timetable DOCX file.
 * This script reads the ZIP, inflates word/document.xml, and prints the grid.
 */
const fs = require('fs');
const { inflateRawSync } = require('zlib');

const filePath = 'c:\\Users\\Aksh\\Desktop\\TT_FOP\\Class TT BPH 1 Div A_26-27.docx';
const buf = fs.readFileSync(filePath);

// Find End of Central Directory
let eocdOffset = -1;
for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) {
    eocdOffset = i;
    break;
  }
}
if (eocdOffset === -1) { console.log('Not a valid ZIP'); process.exit(1); }

const cdOffset = buf.readUInt32LE(eocdOffset + 16);
const cdEntryCount = buf.readUInt16LE(eocdOffset + 10);

let pos = cdOffset;
let xmlContent = null;

for (let i = 0; i < cdEntryCount; i++) {
  if (pos + 46 > buf.length) break;
  if (buf.readUInt32LE(pos) !== 0x02014b50) break;

  const compressedSize = buf.readUInt32LE(pos + 20);
  const filenameLen = buf.readUInt16LE(pos + 28);
  const extraLen = buf.readUInt16LE(pos + 30);
  const commentLen = buf.readUInt16LE(pos + 32);
  const localHeaderOffset = buf.readUInt32LE(pos + 42);
  const filename = buf.slice(pos + 46, pos + 46 + filenameLen).toString('utf-8');

  if (filename === 'word/document.xml') {
    const localPos = localHeaderOffset;
    const localFilenameLen = buf.readUInt16LE(localPos + 26);
    const localExtraLen = buf.readUInt16LE(localPos + 28);
    const compressionMethod = buf.readUInt16LE(localPos + 8);
    const dataStart = localPos + 30 + localFilenameLen + localExtraLen;
    const compData = buf.slice(dataStart, dataStart + compressedSize);

    if (compressionMethod === 0) {
      xmlContent = compData.toString('utf-8');
    } else {
      xmlContent = inflateRawSync(compData).toString('utf-8');
    }
    break;
  }

  pos += 46 + filenameLen + extraLen + commentLen;
}

if (!xmlContent) { console.log('word/document.xml not found'); process.exit(1); }

// Extract tables
const tables = xmlContent.match(/<w:tbl[\s\S]*?<\/w:tbl>/g) || [];
console.log(`Found ${tables.length} table(s)\n`);

for (let tblIdx = 0; tblIdx < tables.length; tblIdx++) {
  const tbl = tables[tblIdx];
  const rowsXml = tbl.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];

  console.log(`\n${'='.repeat(80)}`);
  console.log(`TABLE ${tblIdx}: ${rowsXml.length} rows`);
  console.log('='.repeat(80));

  for (let r = 0; r < rowsXml.length; r++) {
    const tr = rowsXml[r];
    const cellsXml = tr.match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
    const cells = [];

    for (const tc of cellsXml) {
      const paragraphs = tc.match(/<w:p[\s\S]*?<\/w:p>/g) || [tc];
      const paraTexts = [];
      for (const p of paragraphs) {
        const tMatches = p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
        const paraText = tMatches.map(m => m.replace(/<[^>]+>/g, '')).join('').trim();
        if (paraText) paraTexts.push(paraText);
      }
      const cellStr = paraTexts.join(' | ').trim();

      // Check gridSpan
      const gridSpanMatch = /<w:gridSpan\s+w:val="(\d+)"/i.exec(tc);
      const span = gridSpanMatch ? parseInt(gridSpanMatch[1], 10) : 1;

      cells.push({ text: cellStr || '(empty)', span });
    }

    console.log(`\nRow ${r}:`);
    let colIdx = 0;
    for (const c of cells) {
      const spanInfo = c.span > 1 ? ` [span=${c.span}]` : '';
      console.log(`  Col ${colIdx}${spanInfo}: "${c.text}"`);
      colIdx += c.span;
    }
  }
}

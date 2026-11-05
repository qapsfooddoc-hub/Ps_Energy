/**
 * ============================================================================
 * GOOGLE APPS SCRIPT: Energy Usage System Backend API (ระบบบริหารจัดการพลังงาน)
 * ============================================================================
 * 
 * วิธีการติดตั้ง (Quick Setup):
 * 1. เปิด Google Sheets ใหม่ (หรือไฟล์เดิม)
 * 2. เมนูด้านบน เลือก: "ส่วนขยาย" (Extensions) > "Apps Script"
 * 3. ลบโค้ดเดิมออกทั้งหมด แล้ววางโค้ดไฟล์นี้ลงไปทั้งหมด
 * 4. กดปุ่ม "บันทึก" (รูปแผ่นดิสก์)
 * 5. กดปุ่มสีน้ำเงินมุมขวาบน "การทำให้ใช้งานได้" (Deploy) > "การทำให้ใช้งานได้ใหม่" (New deployment)
 * 6. เลือกประเภท: "เว็บแอป" (Web app)
 * 7. ตั้งค่า:
 *    - คำอธิบาย: Energy API
 *    - ดำเนินการในฐานะ: "ฉัน" (Me - บัญชีของคุณ)
 *    - ผู้ที่มีสิทธิ์เข้าถึง: "ทุกคน" (Anyone) **สำคัญมาก ต้องเลือกทุกคน**
 * 8. กด "ทำให้ใช้งานได้" (Deploy) และกดยืนยันสิทธิ์การเข้าถึง (Authorize Access)
 * 9. คัดลอก "URL เว็บแอป" (Web App URL) ที่ขึ้นต้นด้วย https://script.google.com/macros/s/.../exec
 *    นำไปวางในหน้าต่างตั้งค่า Google Sheets บนหน้าเว็บไซต์ของคุณ
 * ============================================================================
 */

const SHEET_ENERGY = "Energy_Summary";
const SHEET_WATER = "Water_Meters";
const SHEET_ELEC = "Elec_Meters";
const SHEET_AUDIT = "Audit_Logs";

function doGet(e) {
  try {
    const action = e.parameter.action || "getData";
    
    if (action === "ping") {
      return jsonResponse({
        status: "success",
        message: "Google Apps Script API is running perfectly!",
        timestamp: new Date().toISOString()
      });
    }
    
    if (action === "getData") {
      const data = getAllDataFromSheets();
      return jsonResponse({
        status: "success",
        data: data,
        timestamp: new Date().toISOString()
      });
    }

    return jsonResponse({ status: "error", message: "Unknown GET action: " + action });
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

function doPost(e) {
  try {
    const contents = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    const action = contents.action || "saveMonth";

    if (action === "ping") {
      return jsonResponse({ status: "success", message: "POST Ping OK" });
    }

    if (action === "seedAllData") {
      const res = seedAllDataToSheets(contents.multiYearData, contents.waterMeters, contents.elecMeters);
      return jsonResponse({ status: "success", message: "Seeded all data successfully", details: res });
    }

    if (action === "saveMonth") {
      const res = saveSingleMonth(contents);
      return jsonResponse({ status: "success", message: "Month saved successfully", details: res });
    }

    return jsonResponse({ status: "error", message: "Unknown POST action: " + action });
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ----------------------------------------------------------------------------
// GET ALL DATA
// ----------------------------------------------------------------------------
function getAllDataFromSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheetsSetup(ss);

  const multiYearData = {};
  const waterMeters = {};
  const elecMeters = {};
  const auditLogs = [];

  // 1. Read Energy Summary
  const sheetEnergy = ss.getSheetByName(SHEET_ENERGY);
  const energyRows = sheetEnergy.getDataRange().getValues();
  // Header: Year(0), Month(1), Production(2), WaterUsage(3), WaterCost(4), ElecUsage(5), ElecCost(6), FuelUsage(7), FuelCost(8), GasUsage(9), GasCost(10), TotalCost(11), CostPerHead(12), UpdatedAt(13)
  for (let i = 1; i < energyRows.length; i++) {
    const r = energyRows[i];
    const year = String(r[0]);
    const month = String(r[1]);
    if (!year || !month || year === "undefined") continue;

    if (!multiYearData[year]) multiYearData[year] = {};

    const prod = Number(r[2]) || 0;
    const waterU = Number(r[3]) || 0;
    const waterC = Number(r[4]) || 0;
    const elecU = Number(r[5]) || 0;
    const elecC = Number(r[6]) || 0;
    const fuelU = Number(r[7]) || 0;
    const fuelC = Number(r[8]) || 0;
    const gasU = Number(r[9]) || 0;
    const gasC = Number(r[10]) || 0;
    const totC = Number(r[11]) || 0;

    multiYearData[year][month] = {
      month: month,
      year: parseInt(year),
      production: prod,
      totalCost: totC,
      updatedAt: r[13] ? String(r[13]) : "",
      isLocked: true,
      items: [
        { id: 1, name: "น้ำ", usage: waterU, unit: "ลบ.ม.", cost: waterC, production: prod, usagePerProd: prod > 0 ? waterU / prod : 0, costPerProd: prod > 0 ? waterC / prod : 0 },
        { id: 2, name: "ไฟฟ้า", usage: elecU, unit: "kWh", cost: elecC, production: prod, usagePerProd: prod > 0 ? elecU / prod : 0, costPerProd: prod > 0 ? elecC / prod : 0 },
        { id: 3, name: "น้ำมันเชื้อเพลิง", usage: fuelU, unit: "ลิตร", cost: fuelC, production: prod, usagePerProd: prod > 0 ? fuelU / prod : 0, costPerProd: prod > 0 ? fuelC / prod : 0 },
        { id: 4, name: "แก๊ส (LPG)", usage: gasU, unit: "กิโลกรัม", cost: gasC, production: prod, usagePerProd: prod > 0 ? gasU / prod : 0, costPerProd: prod > 0 ? gasC / prod : 0 }
      ]
    };
  }

  // 2. Read Water Meters
  const sheetWater = ss.getSheetByName(SHEET_WATER);
  const waterRows = sheetWater.getDataRange().getValues();
  // Header: Year(0), Month(1), Meter_ID(2), Meter_Code(3), House_No(4), Location(5), Usage(6), Cost(7)
  for (let i = 1; i < waterRows.length; i++) {
    const r = waterRows[i];
    const year = String(r[0]);
    const month = String(r[1]);
    if (!year || !month) continue;
    const k = year + "_" + month;
    if (!waterMeters[k]) waterMeters[k] = [];
    waterMeters[k].push({
      id: Number(r[2]) || 0,
      meterCode: String(r[3] || ""),
      houseNo: String(r[4] || ""),
      location: String(r[5] || ""),
      usage: Number(r[6]) || 0,
      cost: Number(r[7]) || 0
    });
  }

  // 3. Read Elec Meters
  const sheetElec = ss.getSheetByName(SHEET_ELEC);
  const elecRows = sheetElec.getDataRange().getValues();
  for (let i = 1; i < elecRows.length; i++) {
    const r = elecRows[i];
    const year = String(r[0]);
    const month = String(r[1]);
    if (!year || !month) continue;
    const k = year + "_" + month;
    if (!elecMeters[k]) elecMeters[k] = [];
    elecMeters[k].push({
      id: Number(r[2]) || 0,
      meterCode: String(r[3] || ""),
      houseNo: String(r[4] || ""),
      location: String(r[5] || ""),
      usage: Number(r[6]) || 0,
      cost: Number(r[7]) || 0
    });
  }

  // 4. Read Audit Logs
  const sheetAudit = ss.getSheetByName(SHEET_AUDIT);
  const auditRows = sheetAudit.getDataRange().getValues();
  // Header: Timestamp(0), Month_Year(1), Editor(2), Reason(3), Changes(4)
  for (let i = 1; i < auditRows.length; i++) {
    const r = auditRows[i];
    if (!r[0]) continue;
    auditLogs.push({
      id: i,
      timestamp: String(r[0]),
      month: String(r[1]),
      editor: String(r[2]),
      reason: String(r[3]),
      changes: String(r[4]).split("\n")
    });
  }

  return {
    multiYearData: multiYearData,
    waterMeters: waterMeters,
    elecMeters: elecMeters,
    auditLogs: auditLogs
  };
}

// ----------------------------------------------------------------------------
// SAVE SINGLE MONTH
// ----------------------------------------------------------------------------
function saveSingleMonth(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheetsSetup(ss);

  const year = payload.year;
  const month = payload.month;
  const monthData = payload.monthData || {};
  const waterMet = payload.waterMeters || [];
  const elecMet = payload.elecMeters || [];
  const auditLog = payload.auditLog;

  // 1. Upsert Energy Summary
  const sheetEnergy = ss.getSheetByName(SHEET_ENERGY);
  const energyData = sheetEnergy.getDataRange().getValues();
  let foundRowIdx = -1;

  for (let i = 1; i < energyData.length; i++) {
    if (String(energyData[i][0]) === String(year) && String(energyData[i][1]) === String(month)) {
      foundRowIdx = i + 1;
      break;
    }
  }

  const items = monthData.items || [];
  const waterItem = items.find(it => it.name && it.name.includes("น้ำ") && !it.name.includes("น้ำมัน")) || {};
  const elecItem = items.find(it => it.name && it.name.includes("ไฟฟ้า")) || {};
  const fuelItem = items.find(it => it.name && it.name.includes("น้ำมัน")) || {};
  const gasItem = items.find(it => it.name && it.name.includes("แก๊ส")) || {};

  const prod = Number(monthData.production) || 0;
  const totC = Number(monthData.totalCost) || 0;
  const costPerHead = prod > 0 ? totC / prod : 0;
  const nowStr = new Date().toLocaleString("th-TH");

  const rowValues = [
    year,
    month,
    prod,
    Number(waterItem.usage) || 0,
    Number(waterItem.cost) || 0,
    Number(elecItem.usage) || 0,
    Number(elecItem.cost) || 0,
    Number(fuelItem.usage) || 0,
    Number(fuelItem.cost) || 0,
    Number(gasItem.usage) || 0,
    Number(gasItem.cost) || 0,
    totC,
    costPerHead,
    nowStr
  ];

  if (foundRowIdx > 0) {
    sheetEnergy.getRange(foundRowIdx, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    sheetEnergy.appendRow(rowValues);
  }

  // 2. Upsert Sub-meters
  upsertSubMeters(ss.getSheetByName(SHEET_WATER), year, month, waterMet);
  upsertSubMeters(ss.getSheetByName(SHEET_ELEC), year, month, elecMet);

  // 3. Append Audit Log if provided
  if (auditLog) {
    const sheetAudit = ss.getSheetByName(SHEET_AUDIT);
    sheetAudit.appendRow([
      auditLog.timestamp || nowStr,
      auditLog.month || (month + " " + year),
      auditLog.editor || "ผู้แก้ไขระบบ",
      auditLog.reason || "-",
      Array.isArray(auditLog.changes) ? auditLog.changes.join("\n") : String(auditLog.changes || "-")
    ]);
  }

  return { year: year, month: month, status: "updated" };
}

function upsertSubMeters(sheet, year, month, metersList) {
  if (!sheet || !metersList || metersList.length === 0) return;
  const values = sheet.getDataRange().getValues();
  const rowsToKeep = [];

  // Keep header
  if (values.length > 0) rowsToKeep.push(values[0]);

  // Keep other months' data
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (String(r[0]) === String(year) && String(r[1]) === String(month)) {
      continue; // Remove old rows for this month
    }
    rowsToKeep.push(r);
  }

  // Add new rows
  metersList.forEach(m => {
    rowsToKeep.push([
      year,
      month,
      m.id || 0,
      m.meterCode || "",
      m.houseNo || "",
      m.location || "",
      Number(m.usage) || 0,
      Number(m.cost) || 0
    ]);
  });

  sheet.clearContents();
  sheet.getRange(1, 1, rowsToKeep.length, rowsToKeep[0].length).setValues(rowsToKeep);
}

// ----------------------------------------------------------------------------
// SEED ALL DATA (2559 - 2569) INITIAL SETUP
// ----------------------------------------------------------------------------
function seedAllDataToSheets(multiYearData, waterMeters, elecMeters) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheetsSetup(ss, true); // true = reset headers

  // 1. Populate Energy Summary
  const sheetEnergy = ss.getSheetByName(SHEET_ENERGY);
  const energyRows = [];
  const years = Object.keys(multiYearData || {}).map(Number).sort((a,b)=>a-b);

  years.forEach(yr => {
    const monthsObj = multiYearData[yr] || {};
    const months = Object.keys(monthsObj);
    months.forEach(m => {
      const d = monthsObj[m];
      if (!d) return;
      const items = d.items || [];
      const waterItem = items.find(it => it.name && it.name.includes("น้ำ") && !it.name.includes("น้ำมัน")) || {};
      const elecItem = items.find(it => it.name && it.name.includes("ไฟฟ้า")) || {};
      const fuelItem = items.find(it => it.name && it.name.includes("น้ำมัน")) || {};
      const gasItem = items.find(it => it.name && it.name.includes("แก๊ส")) || {};

      const prod = Number(d.production) || 0;
      const totC = Number(d.totalCost) || 0;
      const costPerHead = prod > 0 ? totC / prod : 0;

      energyRows.push([
        yr,
        m,
        prod,
        Number(waterItem.usage) || 0,
        Number(waterItem.cost) || 0,
        Number(elecItem.usage) || 0,
        Number(elecItem.cost) || 0,
        Number(fuelItem.usage) || 0,
        Number(fuelItem.cost) || 0,
        Number(gasItem.usage) || 0,
        Number(gasItem.cost) || 0,
        totC,
        costPerHead,
        d.updatedAt || ""
      ]);
    });
  });

  if (energyRows.length > 0) {
    sheetEnergy.getRange(2, 1, energyRows.length, energyRows[0].length).setValues(energyRows);
  }

  // 2. Populate Water Meters
  const sheetWater = ss.getSheetByName(SHEET_WATER);
  const waterRows = [];
  Object.keys(waterMeters || {}).forEach(k => {
    const parts = k.split("_");
    const yr = parts[0];
    const m = parts[1];
    (waterMeters[k] || []).forEach(item => {
      waterRows.push([
        yr,
        m,
        item.id || 0,
        item.meterCode || "",
        item.houseNo || "",
        item.location || "",
        Number(item.usage) || 0,
        Number(item.cost) || 0
      ]);
    });
  });
  if (waterRows.length > 0) {
    sheetWater.getRange(2, 1, waterRows.length, waterRows[0].length).setValues(waterRows);
  }

  // 3. Populate Elec Meters
  const sheetElec = ss.getSheetByName(SHEET_ELEC);
  const elecRows = [];
  Object.keys(elecMeters || {}).forEach(k => {
    const parts = k.split("_");
    const yr = parts[0];
    const m = parts[1];
    (elecMeters[k] || []).forEach(item => {
      elecRows.push([
        yr,
        m,
        item.id || 0,
        item.meterCode || "",
        item.houseNo || "",
        item.location || "",
        Number(item.usage) || 0,
        Number(item.cost) || 0
      ]);
    });
  });
  if (elecRows.length > 0) {
    sheetElec.getRange(2, 1, elecRows.length, elecRows[0].length).setValues(elecRows);
  }

  return {
    energyRecords: energyRows.length,
    waterRecords: waterRows.length,
    elecRecords: elecRows.length
  };
}

// ----------------------------------------------------------------------------
// ENSURE SHEETS EXIST & FORMAT HEADERS
// ----------------------------------------------------------------------------
function ensureSheetsSetup(ss, forceReset) {
  const configs = [
    {
      name: SHEET_ENERGY,
      headers: [
        "ปี (Year)", "เดือน (Month)", "ยอดการผลิต (ตัว)", 
        "น้ำ (ลบ.ม.)", "ค่าน้ำ (บาท)", 
        "ไฟฟ้า (kWh)", "ค่าไฟ (บาท)", 
        "น้ำมัน (ลิตร)", "ค่าน้ำมัน (บาท)", 
        "แก๊ส (กก.)", "ค่าแก๊ส (บาท)", 
        "รวมยอดเงิน (บาท)", "ค่าใช้จ่ายเฉลี่ย/ตัว (บาท)", "อัพเดทล่าสุด"
      ],
      color: "#0284c7" // ฟ้า
    },
    {
      name: SHEET_WATER,
      headers: ["ปี (Year)", "เดือน (Month)", "ลำดับ", "รหัสเครื่องวัด", "บ้านเลขที่", "สถานที่", "ปริมาณการใช้ (ลบ.ม.)", "จำนวนเงิน (บาท)"],
      color: "#0369a1" // น้ำเงิน
    },
    {
      name: SHEET_ELEC,
      headers: ["ปี (Year)", "เดือน (Month)", "ลำดับ", "รหัสเครื่องวัด", "บ้านเลขที่", "สถานที่", "ปริมาณการใช้ (kWh)", "จำนวนเงิน (บาท)"],
      color: "#d97706" // ส้ม
    },
    {
      name: SHEET_AUDIT,
      headers: ["วัน-เวลา (Timestamp)", "รอบเดือน/ปี", "ผู้แก้ไข (Editor)", "เหตุผลการแก้ไข (Reason)", "รายละเอียดการเปลี่ยนแปลง (Changes)"],
      color: "#4f46e5" // ม่วง
    }
  ];

  configs.forEach(cfg => {
    let sheet = ss.getSheetByName(cfg.name);
    if (!sheet) {
      sheet = ss.insertSheet(cfg.name);
    }
    if (forceReset || sheet.getLastRow() === 0) {
      sheet.clear();
      sheet.getRange(1, 1, 1, cfg.headers.length).setValues([cfg.headers]);
      const headerRange = sheet.getRange(1, 1, 1, cfg.headers.length);
      headerRange.setBackground(cfg.color);
      headerRange.setFontColor("#ffffff");
      headerRange.setFontWeight("bold");
      headerRange.setHorizontalAlignment("center");
      sheet.setFrozenRows(1);
    }
  });
}

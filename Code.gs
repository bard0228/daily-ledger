/**
 * 日常記帳本 — 固定定期扣款自動入帳系統 (Google Apps Script)
 * 
 * 功能：
 * 1. 每日自動比對「定期扣款設定」工作表。
 * 2. 凡是「啟用狀態」為「是」且今天為扣款日的項目，自動在「記帳本」新增一筆。
 * 3. 內建防重複檢查（同月份同項目絕不重複扣款）。
 * 4. 隨時可將啟用狀態改為「否」以停止扣款。
 */

const CONFIG_SHEET_NAME = "定期扣款設定";
const LEDGER_SHEET_NAME = "記帳本";
const TIMEZONE = "Asia/Taipei";

/**
 * 當試算表開啟時，自動新增專屬功能選單
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("🔄 定期扣款")
    .addItem("▶️ 立即檢查並入帳（手動執行）", "checkAndAddRecurringExpenses")
    .addSeparator()
    .addItem("⏰ 建立每日自動排程觸發器", "installDailyTrigger")
    .addToUi();
}

/**
 * 核心邏輯：檢查今日是否有到期的定期扣款，若有且尚未記帳則自動寫入
 */
function checkAndAddRecurringExpenses() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  const ledgerSheet = ss.getSheetByName(LEDGER_SHEET_NAME);

  if (!configSheet || !ledgerSheet) {
    Logger.log("找不到設定表或記帳本，請確認工作表名稱");
    return;
  }

  const now = new Date();
  const todayStr = Utilities.formatDate(now, TIMEZONE, "yyyy-MM-dd");
  const currentYearMonth = Utilities.formatDate(now, TIMEZONE, "yyyy-MM");
  const currentDay = parseInt(Utilities.formatDate(now, TIMEZONE, "d"), 10);

  const configData = configSheet.getDataRange().getValues();
  if (configData.length <= 1) {
    Logger.log("定期扣款設定表中沒有資料");
    return;
  }

  // 讀取設定表欄位：啟用狀態(0), 項目名稱(1), 每月扣款日(2), 收支(3), 大類(4), 小類(5), 金額(6), 備註(7)
  let addedCount = 0;
  for (let i = 1; i < configData.length; i++) {
    const row = configData[i];
    const isEnabled = String(row[0]).trim() === "是";
    const itemName = String(row[1]).trim();
    const chargeDay = parseInt(row[2], 10);
    const flowType = String(row[3]).trim() || "支出";
    const category = String(row[4]).trim() || "訂閱";
    const subCategory = String(row[5]).trim() || "訂閱";
    const amount = Number(row[6]) || 0;

    // 檢查是否啟用、是否為今日扣款日
    if (!isEnabled || chargeDay !== currentDay) {
      continue;
    }

    // 檢查本月是否已記過該項目（防止重複記帳）
    if (isItemAlreadyRecorded(ledgerSheet, currentYearMonth, itemName)) {
      Logger.log(`[略過] ${itemName} 本月 (${currentYearMonth}) 已記過帳，不重複扣款`);
      continue;
    }

    // 執行寫入「記帳本」
    insertRecordByDate(ledgerSheet, [todayStr, flowType, category, subCategory, itemName, amount]);
    addedCount++;
    Logger.log(`[成功入帳] ${todayStr} ${category}/${subCategory} ${itemName} NT$ ${amount}`);
  }

  return `檢查完成，共自動新增 ${addedCount} 筆固定支出。`;
}

/**
 * 檢查該項目是否已在該月份記帳過
 */
function isItemAlreadyRecorded(sheet, yearMonth, itemName) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const rawDate = data[i][0];
    const name = String(data[i][4]).trim();
    let rowYM = "";

    if (rawDate instanceof Date) {
      rowYM = Utilities.formatDate(rawDate, TIMEZONE, "yyyy-MM");
    } else if (rawDate) {
      rowYM = String(rawDate).slice(0, 7);
    }

    if (rowYM === yearMonth && name === itemName) {
      return true;
    }
  }
  return false;
}

/**
 * 依照日期排序在適當位置插入新紀錄
 */
function insertRecordByDate(sheet, newRow) {
  const targetDate = newRow[0];
  const data = sheet.getDataRange().getValues();
  let insertIndex = data.length + 1; // 預設放在最後一列下方

  for (let i = 1; i < data.length; i++) {
    const rawDate = data[i][0];
    let rowDate = "";
    if (rawDate instanceof Date) {
      rowDate = Utilities.formatDate(rawDate, TIMEZONE, "yyyy-MM-dd");
    } else if (rawDate) {
      rowDate = String(rawDate).slice(0, 10);
    }

    if (rowDate && rowDate > targetDate) {
      insertIndex = i + 1; // 找到第一個大於該日期的位置，插入其上方
      break;
    }
  }

  sheet.insertRowBefore(insertIndex);
  sheet.getRange(insertIndex, 1, 1, 6).setValues([newRow]);
}

/**
 * 一鍵設定每日定時觸發器（每天上午 8:00 ~ 9:00 自動執行）
 */
function installDailyTrigger() {
  // 先清除舊的觸發器避免重複
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === "checkAndAddRecurringExpenses") {
      ScriptApp.deleteTrigger(t);
    }
  });

  // 建立每日早上 8:00 ~ 9:00 觸發器
  ScriptApp.newTrigger("checkAndAddRecurringExpenses")
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .inTimezone(TIMEZONE)
    .create();

  SpreadsheetApp.getUi().alert("✅ 每日定時自動扣款觸發器已設定成功！\n每天上午 8 點將自動檢查並入帳。");
}

// === Fantasy Football Draft Tool Full Script ===

function onEdit(e) {
  const sheet = e.source.getActiveSheet();
  const sheetName = sheet.getName();
  if (sheetName === "Draft Pool" || sheetName === "Settings") {
    ensureTargetColumn();
    recalculateDraftMetrics();
    updateMockRosterBuilder();
  }
}

function recalculateDraftMetrics() {
  updateBidWindowColumns();
  calculateInflatedPrices();
  calculateVorpAndTiers();
  calculateSavings();
  updateTeamSummary();
}

function getSetting(settings, label, fallback = 1.0) {
  const row = settings.find(r => r[0] && r[0].toString().trim() === label.trim());
  return row ? parseFloat(row[1]) : fallback;
}

function calculateInflatedPrices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Draft Pool");
  const settingsSheet = ss.getSheetByName("Settings");
  const settings = settingsSheet.getRange("A1:B150").getValues();

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();

  const colPrice = headers.indexOf("Projected Price");
  const colKeeper = headers.indexOf("Keeper");
  const colKeeperCost = headers.indexOf("Keeper Cost");
  const colInflated = headers.indexOf("Inflated Price");

  const inflationRate = getSetting(settings, "Inflation Rate", 1.1);

  for (let i = 0; i < data.length; i++) {
    const keeperStatus = (data[i][colKeeper] || '').toString().toLowerCase().trim();
    if (keeperStatus === "my keeper" || keeperStatus === "yes") {
      data[i][colInflated] = parseFloat(data[i][colKeeperCost]) || 0;
    } else {
      const price = parseFloat(data[i][colPrice]) || 0;
      data[i][colInflated] = Math.round(price * inflationRate * 100) / 100;
    }
  }

  sheet.getRange(2, colInflated + 1, data.length).setValues(data.map(r => [r[colInflated]]));
}

function calculateVorpAndTiers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Draft Pool");
  const settingsSheet = ss.getSheetByName("Settings");

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rowCount = sheet.getLastRow();
  const settings = settingsSheet.getRange("A1:B150").getValues();

  const colPosition = headers.indexOf("Position");
  const colPoints = headers.indexOf("Projected Points");
  const colInflated = headers.indexOf("Inflated Price");
  const colVorp = headers.indexOf("Vorp Rank");
  const colVorpDollar = headers.indexOf("Vorp/$");
  const colTier = headers.indexOf("Vorp Tier");

  const replacementLevels = {
    "QB": getSetting(settings, "QB Replacement", 250),
    "RB": getSetting(settings, "RB Replacement", 150),
    "WR": getSetting(settings, "WR Replacement", 130),
    "TE": getSetting(settings, "TE Replacement", 80)
  };

  const tierThresholds = {
    "Elite": getSetting(settings, "Elite VORP/$", 2.5),
    "Good": getSetting(settings, "Good VORP/$", 1.9),
    "Fair": getSetting(settings, "Fair VORP/$", 1.3),
    "Poor": getSetting(settings, "Poor VORP/$", 0.9)
  };

  const data = sheet.getRange(2, 1, rowCount - 1, headers.length).getValues();
  const newVorp = [], newVorpDollar = [], newTier = [];

  for (let i = 0; i < data.length; i++) {
    const position = (data[i][colPosition] || '').toUpperCase();
    const projPoints = parseFloat(data[i][colPoints]) || 0;
    const inflatedPrice = parseFloat(data[i][colInflated]) || 0;
    const replacement = replacementLevels[position] || 0;

    const vorp = projPoints - replacement;
    const vorpPerDollar = inflatedPrice > 0 ? vorp / inflatedPrice : 0;

    let tier = "Overpriced";
    if (vorpPerDollar >= tierThresholds.Elite) tier = "Elite";
    else if (vorpPerDollar >= tierThresholds.Good) tier = "Good";
    else if (vorpPerDollar >= tierThresholds.Fair) tier = "Fair";
    else if (vorpPerDollar >= tierThresholds.Poor) tier = "Poor";

    newVorp.push([Math.round(vorp * 100) / 100]);
    newVorpDollar.push([Math.round(vorpPerDollar * 100) / 100]);
    newTier.push([tier]);
  }

  sheet.getRange(2, colVorp + 1, data.length).setValues(newVorp);
  sheet.getRange(2, colVorpDollar + 1, data.length).setValues(newVorpDollar);
  sheet.getRange(2, colTier + 1, data.length).setValues(newTier);
}

function calculateSavings() {
  // Placeholder or insert your actual logic if needed
}

function updateBidWindowColumns() {
  // Placeholder or insert your actual logic if needed
}

function updateTeamSummary() {
  // Placeholder or insert your actual logic if needed
}

function updateMockRosterBuilder() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const draftSheet = ss.getSheetByName("Draft Pool");
  const mockSheet = ss.getSheetByName("Mock Draft") || ss.insertSheet("Mock Draft");

  const headers = draftSheet.getRange(1, 1, 1, draftSheet.getLastColumn()).getValues()[0];
  const data = draftSheet.getRange(2, 1, draftSheet.getLastRow() - 1, headers.length).getValues();

  const colTarget = headers.indexOf("Target");
  const colKeeper = headers.indexOf("Keeper");
  const colName = headers.indexOf("Player");
  const colPos = headers.indexOf("Position");
  const colPoints = headers.indexOf("Projected Points");
  const colCost = headers.indexOf("Keeper Cost");
  const colFloor = headers.indexOf("Bid Floor");
  const colCeil = headers.indexOf("Bid Ceiling");
  const colVorpDollar = headers.indexOf("Vorp/$");
const selectedPlayers = data.filter(row =>
  (row[colTarget] || '').toString().toLowerCase() === 'yes' ||
  (row[colKeeper] || '').toString().toLowerCase() === 'my keeper'
);




  const rosterPool = selectedPlayers.map(row => {
    const isKeeper = (row[colKeeper] || "").toLowerCase().trim() === "my keeper";
    let cost = isKeeper
  ? parseFloat(row[colCost]) || 0
  : ((parseFloat(row[colFloor]) || 0) + (parseFloat(row[colCeil]) || 0)) / 2;

      if (cost < 1) cost = 1;

    return {
      name: row[colName],
      pos: row[colPos],
      cost: Math.round(cost * 100) / 100,
      points: parseFloat(row[colPoints]) || 0,
      vorp: parseFloat(row[colVorpDollar]) || 0,
      keeper: isKeeper ? "Yes" : "No"
    };
  });

  // Sort players by cost descending
  rosterPool.sort((a, b) => b.cost - a.cost);

  const rosterSlots = [
    { label: "QB1", pos: "QB" },
    { label: "RB1", pos: "RB" },
    { label: "WR1", pos: "WR" },
    { label: "RB2", pos: "RB" },
    { label: "WR2", pos: "WR" },
    { label: "WR/RB/TE", pos: ["WR", "RB", "TE"] },
    { label: "WR/TE", pos: ["WR", "TE"] },
    { label: "Bench1" },
    { label: "Bench2" },
    { label: "Bench3" },
    { label: "Bench4" },
    { label: "Bench5" },
    { label: "Bench6" },
  ];

  const used = new Set();
  const filledRoster = [];

  for (let slot of rosterSlots) {
    let eligible;
    if (Array.isArray(slot.pos)) {
      eligible = rosterPool.filter((p, i) => slot.pos.includes(p.pos) && !used.has(i));
    } else if (slot.pos) {
      eligible = rosterPool.filter((p, i) => p.pos === slot.pos && !used.has(i));
    } else {
      eligible = rosterPool.filter((p, i) => !used.has(i));
    }

    if (eligible.length > 0) {
      const playerIndex = rosterPool.indexOf(eligible[0]);
      filledRoster.push([slot.label, ...Object.values(eligible[0])]);
      used.add(playerIndex);
    } else {
      filledRoster.push([slot.label, "", "", "", "", "", ""]);
    }
  }

  // Calculate totals
  const totalCost = filledRoster.reduce((sum, r) => sum + (parseFloat(r[3]) || 0), 0);
  const totalPoints = filledRoster.reduce((sum, r) => sum + (parseFloat(r[4]) || 0), 0);
  const avgVorp = filledRoster.filter(r => r[4] !== "").reduce((sum, r) => sum + (parseFloat(r[5]) || 0), 0) / filledRoster.filter(r => r[4] !== "").length;


  const rbCount = filledRoster.filter(r => r[1] === "RB").length;
  const tooManyRBs = rbCount > 5;
  const isValid = totalCost <= 200 &&
  filledRoster.length === 13 &&
  filledRoster.slice(0, 7).every(r => parseFloat(r[3]) >= 1);


  // Clear and write
  mockSheet.clearContents();
  mockSheet.getRange("A1:G1").setValues([["Position", "Player", "Pos", "Cost", "Points", "Vorp/$", "Keeper"]]);
  mockSheet.getRange(2, 1, filledRoster.length, 7).setValues(filledRoster);

  mockSheet.getRange("I1").setValue("Total Cost");
  mockSheet.getRange("I2").setValue(Math.round(totalCost * 100) / 100);
  mockSheet.getRange("J1").setValue("Total Points");
  mockSheet.getRange("J2").setValue(Math.round(totalPoints * 100) / 100);
  mockSheet.getRange("K1").setValue("Avg VORP/$");
  mockSheet.getRange("K2").setValue(Math.round(avgVorp * 100) / 100);
  mockSheet.getRange("L1").setValue("Too Many RBs");
  mockSheet.getRange("L2").setValue(tooManyRBs);
  mockSheet.getRange("M1").setValue("Valid Roster?");
  mockSheet.getRange("M2").setValue(isValid ? "VALID" : "INVALID");
}


function ensureTargetColumn() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Draft Pool");
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  let targetCol = headers.indexOf("Target");
  if (targetCol === -1) {
    sheet.insertColumnAfter(headers.length);
    targetCol = headers.length;
    sheet.getRange(1, targetCol + 1).setValue("Target");
  }

  const range = sheet.getRange(2, targetCol + 1, sheet.getMaxRows() - 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Yes", ""], true)
    .setAllowInvalid(true)
    .build();

  range.setDataValidation(rule);
}
function clearTargetSelections() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Draft Pool");
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const targetCol = headers.indexOf("Target");

  if (targetCol === -1) return;

  const rowCount = sheet.getLastRow() - 1;
  const range = sheet.getRange(2, targetCol + 1, rowCount);
  range.clearContent();
}
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Draft Tools')
    .addItem('Update Mock Draft', 'updateMockRosterBuilder')
    .addItem('Clear Target Selections', 'clearTargetSelections')
    .addItem('Recalculate Metrics', 'recalculateDraftMetrics') // ✅ NEW ITEM
    .addToUi();
}
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index');
}function getDraftPoolData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Draft Pool");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colPlayer = headers.indexOf("Player");
  const colPos = headers.indexOf("Position");
  const colFloor = headers.indexOf("Bid Floor");
  const colCeiling = headers.indexOf("Bid Ceiling");
  const colKeeper = headers.indexOf("Keeper");
  const colTarget = headers.indexOf("Target");

  return data.slice(1).map(row => [
    row[colPlayer],
    row[colPos],
    row[colFloor],
    row[colCeiling],
    row[colKeeper],
    row[colTarget]
  ]);
}

function updateKeeperStatus(playerName, status) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Draft Pool");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colPlayer = headers.indexOf("Player");
  const colKeeper = headers.indexOf("Keeper");

  for (let i = 1; i < data.length; i++) {
    if (data[i][colPlayer] === playerName) {
      sheet.getRange(i + 1, colKeeper + 1).setValue(status);
      break;
    }
  }
}

function markPlayerAsTarget(playerName, isChecked) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Draft Pool");
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colPlayer = headers.indexOf("Player");
  const colTarget = headers.indexOf("Target");

  for (let i = 1; i < data.length; i++) {
    if (data[i][colPlayer] === playerName) {
      sheet.getRange(i + 1, colTarget + 1).setValue(isChecked ? "Yes" : "");
      break;
    }
  }
}

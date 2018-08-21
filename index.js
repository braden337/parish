const puppeteer = require("puppeteer");
const createCsvStringifier = require("csv-writer").createObjectCsvStringifier;

const { lotTypes, parishes } = require("./browser");

let deposits = {};

async function allRecords(lotNumber, ls, ps, out) {
  let records = [];
  return new Promise(async function(resolve, reject) {
    for (let l of ls) {
      for (let p of ps) {
        if (out.spinner) out.spinner.start(`Loading ${l} in ${p}`);
        let someRecords = await fetchRecords(
          lotNumber,
          lotTypes.indexOf(l),
          parishes.indexOf(p),
          out
        ).catch(e => {
          out.spinner.fail(e);
          reject(e);
        });
        records = records.concat(someRecords);
      }
    }
    resolve(records);
  });
}

async function fetchRecords(lotNumber, lotType, parish, out) {
  let printer;

  if (out.spinner) {
    printer = function(message, status) {
      if (status == "success") out.spinner.succeed(message);
      else if (status == "fail") out.spinner.fail(message);
      else out.spinner.text = message;
    };
  } else if (out.ws) {
    printer = function(message, status) {
      out.ws.send(JSON.stringify({ message, status }));
    };
  } else {
    printer = _ => 0;
  }

  return new Promise(async function(resolve) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto("https://tprmb.ca/lto/jsp/documentSearchServices.jsp");

    await Promise.all([
      page.waitForNavigation(),
      page.click("a[href='/lto/actions/initializeSearchByParishSettlementLot'")
    ]);

    await Promise.all([
      page.type("input[type='text'][name='lotNumber']", lotNumber),
      page.select("select[name='lotTypeRefId']", String(lotType)),
      page.select("select[name='parishRefId']", String(parish))
    ]);

    await Promise.all([
      page.waitForNavigation(),
      page.click(
        "input[type='submit'][name='searchPlansByParishSettlementLotAction']"
      )
    ]);

    let results = await page
      .$eval("td[class='searchResultsPageText']", x => x.innerText)
      .catch(_ => 0);

    if (results) {
      let pages = 0;
      let records = [];
      results = results.split(" ");
      results = Number(results[results.length - 1]);
      pages = Math.ceil(results / 10);

      for (let i = 1; i <= pages; ) {
        printer(
          `Checking page ${i++} of ${pages} for ${lotTypes[lotType]} in ${
            parishes[parish]
          }`
        );

        let more = await page.$$eval(
          "table#searchResults > tbody > tr:nth-child(even)",
          (rows, deposits) => {
            let pageRecords = rows
              .map(row => {
                let columns = Array.from(row.children)
                  .slice(1)
                  .map(td => td.innerText.trim());

                if (columns.length == 9) columns.shift();

                if (deposits[columns[0]]) return false;
                deposits[columns[0]] = true;

                return {
                  deposit: columns[0],
                  wNo: columns[1],
                  planNo: columns[2],
                  dosNo: columns[3],
                  clsrNo: columns[4],
                  district: columns[5],
                  planType: columns[6],
                  comments: columns[7]
                };
              })
              .filter(Boolean);

            return { pageRecords, deposits };
          },
          deposits
        );
        deposits = more.deposits;
        records.push(...more.pageRecords);

        let navigable = await page.evaluate(_ => !!window.submitform);
        if (navigable)
          await Promise.all([
            page.waitForNavigation(),
            page.evaluate(i => {
              window.submitform(i);
            }, i)
          ]);
      }

      printer(
        `${pages} page${pages == 1 ? "" : "s"} for ${lotTypes[lotType]} in ${
          parishes[parish]
        } 🐱 🎉`,
        "success"
      );

      printer("Writing CSV file ✏️");

      await browser.close();
      resolve(records);
    } else {
      printer(
        `0 pages for ${lotTypes[lotType]} in ${parishes[parish]} 😔`,
        "fail"
      );
      await browser.close();
      resolve([]);
    }
  });
}

function sortRecords(records) {
  let noPlanRecords = records
    .filter(record => record.planNo == "")
    .sort(
      (a, b) => (a.deposit < b.deposit ? -1 : a.deposit > b.deposit ? 1 : 0)
    );

  let planRecords = records
    .filter(record => Boolean(record.planNo))
    .sort((a, b) => a.planNo - b.planNo);

  return planRecords.concat(noPlanRecords);
}

function base64Records(records) {
  const csvStringifier = createCsvStringifier({
    header: [
      { id: "deposit", title: "Deposit" },
      { id: "wNo", title: "W. No" },
      { id: "planNo", title: "Plan No" },
      { id: "dosNo", title: "D of S No" },
      { id: "clsrNo", title: "CLSR No" },
      { id: "district", title: "District" },
      { id: "planType", title: "Plan Type" },
      { id: "comments", title: "Comments" }
    ]
  });
  return Buffer.from(
    csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(records)
  ).toString("base64");
}

async function siteIsDown() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto("https://tprmb.ca/lto/jsp/documentSearchServices.jsp");
  // await page.goto("https://tprmb.ca/sitedown/tpr.down.html");

  let scheduledMaintenance = await page.evaluate(_ => {
    let table = document.querySelector("tbody");

    return !!table && table
      ? table.innerText.indexOf("scheduled maintenance") != -1
      : false;
  });

  return new Promise(async function(resolve) {
    resolve(scheduledMaintenance);
    await browser.close();
  });
}

function imageToDataURL(image) {
  let canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d").drawImage(image, 0, 0);
  return canvas.toDataURL();
}

module.exports = {
  fetchRecords,
  sortRecords,
  base64Records,
  allRecords,
  siteIsDown
};

#!/usr/bin/env node

const inquirer = require("inquirer");
const puppeteer = require("puppeteer");
const ora = require("ora");
const moment = require("moment");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

const strip = a => {
  let m = a.match(/(\d+)/);
  if (m) return m[0];
};

let deposits = {};

const lotTypes = [
  null,
  "Group Lot",
  "Lake Lot",
  "Outer Two Mile",
  "Park Lot",
  "River Lot",
  "Settlement Lot",
  "Wood Lot",
  "Indian Reserve"
];

const parishes = [
  null,
  "Baie Saint Paul",
  "Big Eddy",
  "Brokenhead",
  "Cross Lake",
  "Duck Bay North",
  "Duck Bay South",
  "Fairford",
  "Fairford Mission",
  "Fisher Bay",
  "Fort Alexander",
  "Grand Rapids",
  "Grande Pointe",
  "Headingley",
  "High Bluff",
  "Kildonan",
  "Lorette",
  "Manigotagan River",
  "Manitoba House",
  "Norway House",
  "Oak Island",
  "Oak Point",
  "Pasquia",
  "Pine Creek",
  "Poplar Point",
  "Portage La Prairie",
  "Rat River",
  "Riding Mountain National Park",
  "Roman Catholic Mission Property",
  "Saint Andrews",
  "Saint Boniface",
  "Saint Charles",
  "Saint Clements",
  "Saint Francois Xavier",
  "Saint James",
  "Saint John",
  "Saint Laurent",
  "Saint Malo",
  "Saint Norbert",
  "Saint Paul",
  "Saint Peter",
  "Saint Vital",
  "Sainte Agathe",
  "Sainte Anne",
  "The Pas",
  "Umfreville",
  "Westbourne"
];

let choices = [
  {
    type: "input",
    name: "lotNumber",
    message: "Which lot number(s)?",
    validate: value =>
      /^[0-9]+((-[0-9]+)?|(,[0-9]+)+)$/i.test(value)
        ? true
        : "Please enter a lot number, range or list like 2 or 1-7 or 3,5,10"
  },
  {
    type: "list",
    name: "lotType",
    message: "Which lot type?",
    choices: (() => {
      let c = [];
      for (let i = 1; i < lotTypes.length; i++) {
        c.push({ name: lotTypes[i], value: i });
      }
      c.push(new inquirer.Separator());
      return c;
    })()
  },
  {
    type: "list",
    name: "parish",
    message: "Which parish/settlement?",
    choices: (() => {
      let c = [];
      for (let i = 1; i < parishes.length; i++) {
        c.push({ name: parishes[i], value: i });
      }
      c.push(new inquirer.Separator());
      return c;
    })()
  }
];

inquirer.prompt(choices).then(answers => {
  (async () => {
    const filename = `${parishes[answers.parish]} - ${
      lotTypes[answers.lotType]
    } - ${answers.lotNumber} - ${moment().format("MMM D YYYY")}.csv`;

    const csvWriter = createCsvWriter({
      path: `${process.cwd()}/${filename}`,
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

    const spinner = ora(`Loading`).start();

    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto("https://tprmb.ca/lto/jsp/documentSearchServices.jsp");

    await Promise.all([
      page.waitForNavigation(),
      page.click("a[href='/lto/actions/initializeSearchByParishSettlementLot'")
    ]);

    await Promise.all([
      page.type("input[type='text'][name='lotNumber']", answers.lotNumber),
      page.select("select[name='lotTypeRefId']", String(answers.lotType)),
      page.select("select[name='parishRefId']", String(answers.parish))
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
      results = results.split(" ");
      results = Number(results[results.length - 1]);
      pages = Math.ceil(results / 10);

      for (let i = 1; i <= pages; ) {
        spinner.text = `Checking page ${i++} of ${pages} for ${
          lotTypes[answers.lotType]
        } in ${parishes[answers.parish]}`;

        let more = await page.$$eval(
          "table#searchResults > tbody > tr:nth-child(even)",
          (rows, deposits) => {
            for (let row of rows) {
              let columns = Array.from(row.children)
                .slice(1)
                .map(td => td.innerText.trim());

              if (columns.length == 9) columns.shift();

              let deposit = columns[0];
              let wNo = columns[1];
              let planNo = columns[2];
              let dosNo = columns[3];
              let clsrNo = columns[4];
              let district = columns[5];
              let planType = columns[6];
              let comments = columns[7];

              let current = {
                deposit,
                wNo,
                planNo,
                dosNo,
                clsrNo,
                district,
                planType,
                comments
              };

              let existing = deposits[current.deposit];

              if (
                !existing ||
                existing.comments.length < current.comments.length
              )
                deposits[deposit] = current;
            }

            return { deposits };
          },
          deposits
        );

        deposits = more.deposits;

        await Promise.all([
          page.waitForNavigation(),
          page.evaluate(i => window.submitform(i), i)
        ]);
      }

      let records = Object.values(deposits);

      spinner.succeed(
        `Went through ${pages} pages for ${lotTypes[answers.lotType]} in ${
          parishes[answers.parish]
        } 🐱 🎉`
      );

      spinner.text = "Writing CSV file ✏️";

      let noPlanRecords = records
        .filter(record => record.planNo == "")
        .sort((a, b) => {
          if (Number(a.deposit) && Number(b.deposit)) {
            return a.deposit - b.deposit;
          } else {
            return Number(strip(a.deposit)) - Number(strip(b.deposit));
          }
        });

      let planRecords = records
        .filter(record => Boolean(record.planNo))
        .sort((a, b) => {
          if (Number(a.planNo) && Number(b.planNo)) {
            return a.planNo - b.planNo;
          } else if (Number(a.planNo)) {
            return -1;
          } else return a.planNo < b.planNo ? -1 : a.planNo > b.planNo ? 1 : 0;
        });

      csvWriter.writeRecords(planRecords.concat(noPlanRecords)).then(() => {
        spinner.succeed(`Saved results to "${filename}" 💾`);
      });
    } else {
      spinner.fail("There aren't any results to save 😔");
    }

    await browser.close();
  })();
});

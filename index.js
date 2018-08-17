#!/usr/bin/env node

const inquirer = require("inquirer");
const puppeteer = require("puppeteer");
const ora = require("ora");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

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
    const filename = `${new Date().toLocaleDateString()} - ${
      lotTypes[answers.lotType]
    } - ${parishes[answers.parish]}.csv`;

    const csvWriter = createCsvWriter({
      path: filename,
      header: [
        { id: "lot", title: "Lot" },
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
      let records = [];
      results = results.split(" ");
      results = Number(results[results.length - 1]);
      pages = Math.ceil(results / 10);

      for (let i = 1; i <= pages; ) {
        spinner.text = `Scraping page ${i++} of ${pages}`;

        let pageRecords = await page.$$eval(
          "table#searchResults > tbody > tr:nth-child(even)",
          rows =>
            rows.map(row => ({
              lot: row.children[1].innerText.trim(),
              deposit: row.children[2].innerText.trim(),
              wNo: row.children[3].innerText.trim(),
              planNo: row.children[4].innerText.trim(),
              dosNo: row.children[5].innerText.trim(),
              clsrNo: row.children[6].innerText.trim(),
              district: row.children[7].innerText.trim(),
              planType: row.children[8].innerText.trim(),
              comments: row.children[9].innerText.trim()
            }))
        );

        records.push(...pageRecords);

        await Promise.all([
          page.waitForNavigation(),
          page.evaluate(i => window.submitform(i), i)
        ]);
      }

      spinner.succeed(`Scraped ${pages} pages 🐱 🎉`);

      spinner.text = "Writing CSV file ✏️";

      csvWriter.writeRecords(records).then(() => {
        spinner.succeed(`Saved results to "${filename}" 💾`);
      });
    } else {
      spinner.fail("There aren't any results to save 😔");
    }

    await browser.close();
  })();
});

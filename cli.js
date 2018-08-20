#!/usr/bin / env node

const inquirer = require("inquirer");
const ora = require("ora");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const moment = require("moment");

const {
  fetchRecords,
  sortRecords,
  allRecords,
  siteIsDown
} = require("./index");
const { lotTypes, parishes } = require("./browser");

const header = [
  { id: "deposit", title: "Deposit" },
  { id: "wNo", title: "W. No" },
  { id: "planNo", title: "Plan No" },
  { id: "dosNo", title: "D of S No" },
  { id: "clsrNo", title: "CLSR No" },
  { id: "district", title: "District" },
  { id: "planType", title: "Plan Type" },
  { id: "comments", title: "Comments" }
];

async function interactive(out) {
  out.spinner.stop();
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

  inquirer.prompt(choices).then(async answers => {
    const filename = `${parishes[answers.parish]} - ${
      lotTypes[answers.lotType]
    } - ${answers.lotNumber} - ${moment().format("MMM D YYYY")}.csv`;

    const csvWriter = createCsvWriter({
      path: `${process.cwd()}/${filename}`,
      header
    });

    out.spinner.start("Loading");

    let records = await fetchRecords(
      answers.lotNumber,
      answers.lotType,
      answers.parish,
      out
    );
    if (records.length)
      csvWriter.writeRecords(sortRecords(records)).then(() => {
        out.spinner.succeed(`Saved results to "${filename}" 💾`);
      });
    else out.spinner.fail("No results to save");
  });
}

async function allParishes(lotNumber, lotTypes, parishes, out) {
  const filename = `${moment().format("MMM D YYYY")}.csv`;

  const csvWriter = createCsvWriter({
    path: `${process.cwd()}/${filename}`,
    header
  });

  let records = await allRecords(lotNumber, lotTypes, parishes, out);

  csvWriter.writeRecords(sortRecords(records)).then(() => {
    out.spinner.succeed(`Saved results to "${filename}" 💾`);
  });
}

(async () => {
  let lotNumber = process.argv.pop();
  let all = process.argv.pop();

  let spinner = ora("Checking that site is available").start();
  let m = await siteIsDown();
  if (!m) {
    if (all == "all" && /^[0-9]+((-[0-9]+)?|(,[0-9]+)+)$/i.test(lotNumber)) {
      await allParishes(lotNumber, lotTypes.slice(1), parishes.slice(1), {
        spinner
      });
    } else {
      await interactive({ spinner });
    }
  } else {
    spinner.fail("Site is down for scheduled maintenance");
  }
})();

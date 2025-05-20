import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { commonOptions } from "./common.js";
import { getAvailableTemplates } from "../utils/file.js";
import { llmAgents } from "../utils/utils.js";

const availableTemplateNames = getAvailableTemplates().map((template) => template.filename);

export const args = commonOptions(yargs(hideBin(process.argv)))
  .scriptName("mulmo-tool")
  .option("u", {
    alias: "url",
    description: "URLs to reference (required when not in interactive mode)",
    demandOption: false,
    default: [],
    type: "array",
    string: true,
  })
  .option("i", {
    alias: "interactive",
    description: "Generate script in interactive mode with user prompts",
    demandOption: false,
    type: "boolean",
  })
  .option("t", {
    alias: "template",
    description: "Template name to use",
    demandOption: false,
    choices: availableTemplateNames,
    type: "string",
  })
  .option("c", {
    alias: "cache",
    description: "cache dir",
    demandOption: false,
    type: "string",
  })
  .option("s", {
    alias: "script",
    description: "script filename",
    demandOption: false,
    default: "script",
    type: "string",
  })
  .option("llm_agent", {
    description: "llm agent",
    demandOption: false,
    choices: llmAgents,
    type: "string",
  })
  .option("llm_model", {
    description: "llm model",
    demandOption: false,
    type: "string",
  })
  .command("$0 <action> [storyFile]", "Run mulmocast tool", (yargs) => {
    return yargs
      .positional("action", {
        describe: "action to perform",
        choices: ["scripting", "prompt", "schema", "story-to-script"] as const,
        type: "string",
      })
      .positional("storyFile", {
        describe: "story file path (required for story-to-script action)",
        type: "string",
      })
      .option("beats_per_scene", {
        description: "Number of beats per scene (for story-to-script action)",
        demandOption: false,
        default: 3,
        type: "number",
      });
  })
  .strict()
  .help()
  .alias("help", "h")
  .parseSync();

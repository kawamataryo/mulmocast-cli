import path from "path";
import { getBaseDirPath, getTemplateFilePath, writingMessage } from "../utils/file.js";
import { mulmoScriptSchema, mulmoScriptTemplateSchema, mulmoStoryboardSchema } from "../types/schema.js";
import { MulmoScriptTemplate, MulmoStoryboard } from "../types/index.js";
import { GraphAI, GraphAILogger, GraphData } from "graphai";
import { openAIAgent } from "@graphai/openai_agent";
import * as agents from "@graphai/vanilla";
import { graphDataScriptGeneratePrompt, sceneToBeatsPrompt, storyToScriptInfoPrompt } from "../utils/prompt.js";
import { fileWriteAgent } from "@graphai/vanilla_node_agents";
import validateSchemaAgent from "../agents/validate_schema_agent.js";

const { default: __, ...vanillaAgents } = agents;

const graphData: GraphData = {
  version: 0.5,
  nodes: {
    scenes: {
      value: [],
    },
    beatsPrompt: {
      value: "",
    },
    scriptInfoPrompt: {
      value: "",
    },
    outdir: {
      value: "",
    },
    fileName: {
      value: "",
    },
    script: {
      agent: "mapAgent",
      inputs: {
        rows: ":scenes",
        prompt: ":beatsPrompt",
      },
      params: {
        compositeResult: true,
      },
      graph: {
        nodes: {
          beats: {
            agent: "nestedAgent",
            inputs: {
              prompt: ":prompt",
              row: ":row",
            },
            isResult: true,
            graph: {
              loop: {
                while: ":continue",
              },
              nodes: {
                counter: {
                  value: 0,
                  update: ":counter.add(1)",
                },
                llm: {
                  agent: "openAIAgent",
                  inputs: {
                    model: "gpt-4o",
                    system: ":prompt",
                    prompt: graphDataScriptGeneratePrompt("${:row}"),
                  },
                },
                validateSchema: {
                  agent: "validateSchemaAgent",
                  inputs: {
                    text: ":llm.text.codeBlock()",
                    schema: mulmoScriptSchema.shape.beats,
                  },
                  isResult: true,
                },
                continue: {
                  agent: ({ isValid, counter }: { isValid: boolean; counter: number }) => {
                    if (counter >= 3) {
                      GraphAILogger.error("Failed to generate a valid script. Please try again.");
                      process.exit(1);
                    }
                    return !isValid;
                  },
                  inputs: {
                    counter: ":counter",
                    isValid: ":validateSchema.isValid",
                  },
                },
              },
            },
          },
        },
      },
      console: {
        after: true,
      },
    },
    beats: {
      agent: "arrayFlatAgent",
      inputs: {
        array: ":script.beats.validateSchema.data",
      },
      isResult: true,
    },
    scriptInfo: {
      agent: "nestedAgent",
      inputs: {
        prompt: ":scriptInfoPrompt",
      },
      graph: {
        loop: {
          while: ":continue",
        },
        nodes: {
          counter: {
            value: 0,
            update: ":counter.add(1)",
          },
          llm: {
            agent: "openAIAgent",
            inputs: {
              model: "gpt-4o",
              prompt: ":prompt",
            },
          },
          validateSchema: {
            agent: "validateSchemaAgent",
            inputs: {
              text: ":llm.text.codeBlock()",
              schema: mulmoScriptSchema.omit({ beats: true }),
            },
            isResult: true,
          },
          continue: {
            agent: ({ isValid, counter }: { isValid: boolean; counter: number }) => {
              if (counter >= 3) {
                GraphAILogger.error("Failed to generate a valid script. Please try again.");
                process.exit(1);
              }
              return !isValid;
            },
            inputs: {
              counter: ":counter",
              isValid: ":validateSchema.isValid",
            },
          },
        },
      },
      console: {
        after: true,
      },
    },
    mergedScript: {
      agent: "mergeObjectAgent",
      inputs: {
        items: [":scriptInfo.validateSchema.data", { beats: ":beats.array" }],
      },
    },
    writeJSON: {
      agent: "fileWriteAgent",
      inputs: {
        file: "${:outdir}/${:fileName}-${@now}.json",
        text: ":mergedScript.toJSON()",
      },
      isResult: true,
    },
  },
};

const generateBeatsPrompt = async (template: MulmoScriptTemplate, beatsPerScene: number, story: MulmoStoryboard) => {
  const allScenes = story.scenes.map((scene) => scene.description).join("\n");
  const sampleBeats = template.script?.beats ?? [];
  return sceneToBeatsPrompt({ sampleBeats, beatsPerScene, allScenes });
};

const generateScriptInfoPrompt = async (template: MulmoScriptTemplate, story: MulmoStoryboard) => {
  if (!template.script) {
    // TODO: use default schema
    throw new Error("script is not provided");
  }
  const { beats: __, ...sampleScriptWithoutBeats } = template.script;
  return storyToScriptInfoPrompt(sampleScriptWithoutBeats, story);
};

const storyToScript = async ({ story, beatsPerScene, templateName }: { story: MulmoStoryboard; beatsPerScene: number; templateName: string }) => {
  const templatePath = getTemplateFilePath(templateName);
  const rowTemplate = await import(path.resolve(templatePath), { assert: { type: "json" } }).then((mod) => mod.default);
  const template = mulmoScriptTemplateSchema.parse(rowTemplate);

  const beatsPrompt = await generateBeatsPrompt(template, beatsPerScene, story);
  const scriptInfoPrompt = await generateScriptInfoPrompt(template, story);

  const graph = new GraphAI(graphData, { ...vanillaAgents, openAIAgent, fileWriteAgent, validateSchemaAgent });

  graph.injectValue("beatsPrompt", beatsPrompt);
  graph.injectValue("scriptInfoPrompt", scriptInfoPrompt);
  graph.injectValue("scenes", story.scenes);
  // TODO: use cli args
  graph.injectValue("outdir", path.resolve(process.cwd(), "output"));
  graph.injectValue("fileName", "script");

  const result = await graph.run<{ path: string }>();
  writingMessage(result?.writeJSON?.path ?? "");
};

const main = async () => {
  const beatsPerScene = 3;
  const templateName = "business";
  const storyPath = "./scripts/test/mulmo_story.json";

  const storyRaw = await import(path.resolve(getBaseDirPath(), storyPath), { assert: { type: "json" } }).then((mod) => mod.default);
  const story = mulmoStoryboardSchema.parse(storyRaw);

  await storyToScript({ story, beatsPerScene, templateName });
};

main();

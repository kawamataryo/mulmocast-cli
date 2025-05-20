import path from "path";
import { getTemplateFilePath, readAndParseJson, writingMessage } from "../utils/file.js";
import { mulmoScriptSchema, mulmoScriptTemplateSchema, mulmoStoryboardSchema } from "../types/schema.js";
import { MulmoScriptTemplate, MulmoStoryboard } from "../types/index.js";
import { GraphAI, GraphAILogger, GraphData } from "graphai";
import { openAIAgent } from "@graphai/openai_agent";
import * as agents from "@graphai/vanilla";
import { graphDataScriptGeneratePrompt, sceneToBeatsPrompt, storyToScriptInfoPrompt } from "../utils/prompt.js";
import { fileWriteAgent } from "@graphai/vanilla_node_agents";
import validateSchemaAgent from "../agents/validate_schema_agent.js";
import { ZodSchema } from "zod";

const { default: __, ...vanillaAgents } = agents;

const createValidatedScriptGraphData = ({ systemPrompt, prompt, schema }: { systemPrompt: string; prompt: string; schema: ZodSchema }) => {
  return {
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
          system: systemPrompt,
          prompt: prompt,
        },
      },
      validateSchema: {
        agent: "validateSchemaAgent",
        inputs: {
          text: ":llm.text.codeBlock()",
          schema: schema,
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
  };
};

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
          script: {
            agent: "nestedAgent",
            inputs: {
              prompt: ":prompt",
              row: ":row",
            },
            graph: createValidatedScriptGraphData({
              systemPrompt: ":prompt",
              prompt: graphDataScriptGeneratePrompt("${:row}"),
              schema: mulmoScriptSchema.shape.beats,
            }),
          },
          json: {
            agent: "copyAgent",
            inputs: {
              json: ":script.validateSchema.data",
            },
            params: {
              namedKey: "json",
            },
            isResult: true,
          },
        },
      },
    },
    beats: {
      agent: "arrayFlatAgent",
      inputs: {
        array: ":script.json",
      },
      isResult: true,
    },
    scriptInfo: {
      agent: "nestedAgent",
      inputs: {
        prompt: ":scriptInfoPrompt",
      },
      graph: createValidatedScriptGraphData({
        systemPrompt: "",
        prompt: ":prompt",
        schema: mulmoScriptSchema.omit({ beats: true }),
      }),
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

export const storyToScript = async ({
  storyPath,
  beatsPerScene,
  templateName,
  outDirPath,
  filename,
}: {
  storyPath: string;
  beatsPerScene: number;
  templateName: string;
  outDirPath: string;
  filename: string;
}) => {
  const templatePath = getTemplateFilePath(templateName);
  const rowTemplate = await import(path.resolve(templatePath), { assert: { type: "json" } }).then((mod) => mod.default);
  const template = mulmoScriptTemplateSchema.parse(rowTemplate);

  const story = readAndParseJson(storyPath, mulmoStoryboardSchema);

  const beatsPrompt = await generateBeatsPrompt(template, beatsPerScene, story);
  const scriptInfoPrompt = await generateScriptInfoPrompt(template, story);

  const graph = new GraphAI(graphData, { ...vanillaAgents, openAIAgent, fileWriteAgent, validateSchemaAgent });

  graph.injectValue("beatsPrompt", beatsPrompt);
  graph.injectValue("scriptInfoPrompt", scriptInfoPrompt);
  graph.injectValue("scenes", story.scenes);
  graph.injectValue("outdir", outDirPath);
  graph.injectValue("fileName", filename);

  const result = await graph.run<{ path: string }>();
  writingMessage(result?.writeJSON?.path ?? "");
};

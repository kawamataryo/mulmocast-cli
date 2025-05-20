import fs from "fs";
import path from "path";
import { parse as yamlParse } from "yaml";
import { fileURLToPath } from "url";
import { GraphAILogger } from "graphai";
import { MulmoScript, MulmoScriptTemplate, MulmoMediaSource, MulmoStudioContext } from "../types/index.js";
import { MulmoScriptTemplateMethods } from "../methods/mulmo_script_template.js";
import { MulmoStudioContextMethods } from "../methods/index.js";
import { mulmoScriptTemplateSchema } from "../types/schema.js";
import { PDFMode } from "../types/index.js";
import { ZodSchema } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function readMulmoScriptFile<T = MulmoScript>(
  path: string,
  errorMessage: string,
): {
  mulmoData: T;
  mulmoDataPath: string;
  fileName: string;
};

export function readMulmoScriptFile<T = MulmoScript>(
  path: string,
): {
  mulmoData: T;
  mulmoDataPath: string;
  fileName: string;
} | null;

export function readMulmoScriptFile<T = MulmoScript>(arg2: string, errorMessage?: string) {
  const scriptPath = path.resolve(arg2);
  if (!fs.existsSync(scriptPath)) {
    if (errorMessage) {
      GraphAILogger.info(errorMessage);
      process.exit(1);
    }
    return null;
  }
  const scriptData = fs.readFileSync(scriptPath, "utf-8");
  const script = ([".yaml", ".yml"].includes(path.extname(scriptPath).toLowerCase()) ? yamlParse(scriptData) : JSON.parse(scriptData)) as T;
  const parsedPath = path.parse(scriptPath);

  return {
    mulmoData: script,
    mulmoDataPath: scriptPath,
    fileName: parsedPath.name,
  };
}
export const fetchMulmoScriptFile = async (url: string) => {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { result: false, status: res.status };
    }
    const script = await res.json();
    return {
      result: true,
      script,
    };
  } catch {
    return { result: false, status: "unknown" };
  }
};

export const getOutputStudioFilePath = (outDirPath: string, fileName: string) => {
  return path.resolve(outDirPath, fileName + "_studio.json");
};
export const resolveDirPath = (dirPath: string, studioFileName: string) => {
  return path.resolve(dirPath, studioFileName);
};
// TODO: probably better to just use resolveDirPath instead.
export const getAudioSegmentDirPath = (audioDirPath: string, studioFileName: string) => {
  return path.resolve(audioDirPath, studioFileName);
};
export const getAudioSegmentFilePath = (audioDirPath: string, studioFileName: string, fileName: string) => {
  return path.resolve(getAudioSegmentDirPath(audioDirPath, studioFileName), fileName + ".mp3");
};
export const getAudioCombinedFilePath = (audioDirPath: string, fileName: string, lang?: string) => {
  if (lang) {
    return path.resolve(audioDirPath, fileName, `${fileName}_${lang}.mp3`);
  }
  return path.resolve(audioDirPath, fileName, fileName + ".mp3");
};
export const getAudioArtifactFilePath = (outDirPath: string, fileName: string) => {
  return path.resolve(outDirPath, fileName + ".mp3");
};
export const getOutputVideoFilePath = (outDirPath: string, fileName: string, lang?: string) => {
  if (lang) {
    return path.resolve(outDirPath, `${fileName}_${lang}.mp4`);
  }
  return path.resolve(outDirPath, fileName + ".mp4");
};
export const getOutputPdfFilePath = (outDirPath: string, fileName: string, pdfMode: PDFMode, lang?: string) => {
  if (lang) {
    return path.resolve(outDirPath, `${fileName}_${pdfMode}_${lang}.pdf`);
  }
  return path.resolve(outDirPath, `${fileName}_${pdfMode}.pdf`);
};
export const getTemplateFilePath = (templateName: string) => {
  return path.resolve(__dirname, "../../assets/templates/" + templateName + ".json");
};

export const mkdir = (dirPath: string) => {
  if (!fs.existsSync(dirPath)) {
    GraphAILogger.info("mkdir: " + dirPath);
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

export const silentPath = path.resolve(__dirname, "../../assets/audio/silent300.mp3");
export const silentLastPath = path.resolve(__dirname, "../../assets/audio/silent800.mp3");
export const silent60secPath = path.resolve(__dirname, "../../assets/audio/silent60sec.mp3");
export const defaultBGMPath = path.resolve(__dirname, "../../assets/music/StarsBeyondEx.mp3");

export const getHTMLFile = (filename: string) => {
  const htmlPath = path.resolve(__dirname, `../../assets/html/${filename}.html`);
  return fs.readFileSync(htmlPath, "utf-8");
};

// for cli
export const getBaseDirPath = (basedir?: string) => {
  if (!basedir) {
    return process.cwd();
  }
  if (path.isAbsolute(basedir)) {
    return path.normalize(basedir);
  }
  return path.resolve(process.cwd(), basedir);
};

export const getFullPath = (baseDirPath: string | undefined, file: string) => {
  if (path.isAbsolute(file)) {
    return path.normalize(file);
  }
  if (baseDirPath) {
    return path.resolve(baseDirPath, file);
  }
  return path.resolve(file);
};

export const readTemplatePrompt = (templateName: string) => {
  const templatePath = getTemplateFilePath(templateName);
  const scriptData = fs.readFileSync(templatePath, "utf-8");
  const template = mulmoScriptTemplateSchema.parse(JSON.parse(scriptData));
  const prompt = MulmoScriptTemplateMethods.getSystemPrompt(template);
  return prompt;
};

export const getAvailableTemplates = (): (MulmoScriptTemplate & { filename: string })[] => {
  const templatesDir = path.resolve(__dirname, "../../assets/templates");

  if (!fs.existsSync(templatesDir)) {
    return [];
  }

  const files = fs.readdirSync(templatesDir);
  return files.map((file) => {
    const template = JSON.parse(fs.readFileSync(path.resolve(templatesDir, file), "utf-8"));
    return {
      ...mulmoScriptTemplateSchema.parse(template),
      filename: file.replace(/\.json$/, ""),
    };
  });
};

export const writingMessage = (filePath: string) => {
  GraphAILogger.info(`writing: ${filePath}`);
};

export const resolveMediaSource = (source: MulmoMediaSource, context: MulmoStudioContext) => {
  if (source.kind === "path") {
    return MulmoStudioContextMethods.resolveAssetPath(context, source.path);
  }
  if (source.kind === "url") {
    return source.url;
  }
  return null;
};

export const readAndParseJson = (filePath: string, zodSchema: ZodSchema) => {
  const json = fs.readFileSync(filePath, "utf-8");
  return zodSchema.parse(JSON.parse(json));
};

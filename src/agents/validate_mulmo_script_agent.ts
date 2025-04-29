import type { AgentFunction, AgentFunctionInfo, DefaultConfigData } from "graphai";
import { mulmoScriptSchema } from "../schema";
import { MulmoScript } from "../type";

type ValidateMulmoScriptInputs = {
  text: string;
};

type ValidateMulmoScriptResponse = {
  isValid: boolean;
  data?: MulmoScript;
  error?: string;
};

/**
 * MulmoScript JSON validation agent
 * Validates if a JSON string conforms to the MulmoScript schema
 */
export const validateMulmoScriptAgent: AgentFunction<object, ValidateMulmoScriptResponse, ValidateMulmoScriptInputs, DefaultConfigData> = async ({ namedInputs }) => {
  const { text } = namedInputs;
  try {
    const jsonData = JSON.parse(text);
    const parsed = mulmoScriptSchema.parse(jsonData);
    return {
      isValid: true,
      data: parsed,
    };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const validateMulmoScriptAgentInfo: AgentFunctionInfo = {
  name: "validateMulmoScriptAgent",
  agent: validateMulmoScriptAgent,
  mock: validateMulmoScriptAgent,
  samples: [],
  description: "Validates if a JSON string conforms to the MulmoScript schema",
  category: ["validation"],
  author: "Receptron Team",
  repository: "https://github.com/receptron/mulmocast-cli/tree/main/src/agents/validate_script_agent.ts",
  license: "MIT",
};

export default validateMulmoScriptAgentInfo;

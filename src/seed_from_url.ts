import "dotenv/config";
import { GraphAI, GraphData } from "graphai";
import * as agents from "@graphai/agents";
import { prompts } from "./agents/prompts_data";
import { fileWriteAgent } from "@graphai/vanilla_node_agents";
import { browserlessAgent } from "@graphai/browserless_agent";
import validateMulmoScriptAgentInfo from "./agents/validate_mulmo_script_agent";
import { z } from "zod";

// ZodスキーマでURLを検証
const urlSchema = z.string().url({ message: "Invalid URL format" });

// GraphAIのグラフ定義
const graphData: GraphData = {
  version: 0.5,
  // ループ処理の設定 - URLリストが空になるまで繰り返す
  loop: {
    while: ":urls.$value.length > 0",
  },
  nodes: {
    // URLリスト (初期値はmainで注入)
    urls: {
      value: [],
      // 次のURLを取得後、残りのURLで更新
      update: ":nextUrl.result.remainingUrls",
    },
    // 処理結果を蓄積するリスト
    results: {
      value: [],
      // 処理結果を追加して更新
      update: ":addResult.result",
      isResult: true,
    },
    // 次のURLを取得する（配列の先頭から1つ取り出す）
    nextUrl: {
      agent: "computedAgent",
      params: {
        expression: (urls: string[]) => {
          if (urls.length === 0) return { currentUrl: null, remainingUrls: [] };
          // 先頭のURLを取り出し、残りを返す
          const [currentUrl, ...remainingUrls] = urls;
          return { currentUrl, remainingUrls };
        }
      },
      inputs: {
        urls: ":urls.$value",
      },
    },
    // 単一URLのコンテンツを取得する
    fetchContent: {
      if: ":nextUrl.result.currentUrl",
      agent: "nestedAgent",
      inputs: {
        url: ":nextUrl.result.currentUrl",
      },
      graph: {
        nodes: {
          // URLからコンテンツを取得
          getContent: {
            agent: "browserlessAgent",
            params: { failOnError: false },
            inputs: {
              url: ":url", // 親から渡されたURL
              text_content: true, // テキストコンテンツを取得
            },
          },
          // コンテンツ取得結果を整形
          formatResult: {
            agent: "computedAgent",
            inputs: {
              url: ":url",
              textContent: ":getContent.result.textContent",
              contentFetched: "!!:getContent.result.textContent",
            },
            params: {
              expression: ({ url, textContent, contentFetched }: {
                url: string;
                textContent: string | null;
                contentFetched: boolean;
              }) => {
                if (!contentFetched) return null;
                return { url, content: textContent };
              }
            },
            isResult: true,
          },
        },
      },
    },
    // 取得結果を結果リストに追加
    addResult: {
      agent: "computedAgent",
      params: {
        expression: (currentResults: Array<{ url: string; content: string } | null>, newResult: { url: string; content: string } | null) => {
          // nullでない結果のみ追加
          if (!newResult) return currentResults;
          return [...currentResults, newResult];
        }
      },
      inputs: {
        currentResults: ":results.$value",
        newResult: ":fetchContent.result.formatResult",
      },
    },
    // 有効なコンテンツのみをフィルタリング（ループ後に実行）
    validContents: {
      agent: "computedAgent",
      params: {
        expression: (results: Array<{ url: string; content: string } | null>) => {
          return results.filter(item => item !== null);
        }
      },
      inputs: {
        results: ":results",
      },
    },
    // フォーマットされたコンテンツリストを生成
    generateMulmoScript: {
      if: ":validContents.result.length > 0",
      agent: "computedAgent",
      params: {
        expression: (contentList: Array<{ url: string; content: string }>) => {
          // URLとコンテンツのリストを整形して文字列化
          return contentList.map((item, index) => 
            `URL ${index + 1}: ${item.url}\n\nContent ${index + 1}:\n${item.content.slice(0, 2000)}${item.content.length > 2000 ? '... (truncated)' : ''}\n\n---\n\n`
          ).join('');
        }
      },
      inputs: {
        contentList: ":validContents.result"
      },
    },
    // MulmoScriptを生成
    generateScript: {
      if: ":generateMulmoScript.result",
      agent: "openAIAgent",
      params: {
        model: "gpt-4o",
        failOnError: false,
      },
      inputs: {
        messages: [
          { role: "system", content: prompts.prompt_seed },
          { role: "user", content: "Generate MulmoScript based on the content of the following URLs:\n\n${:generateMulmoScript.result}" }
        ],
      },
    },
    // 生成されたスクリプトからコードブロックを抽出
    extractedCode: {
      if: ":generateScript.result.text",
      agent: "copyAgent",
      inputs: {
        code: ":generateScript.result.text.codeBlock()",
        originalText: ":generateScript.result.text"
      }
    },
    // 抽出したコードを検証
    validateScript: {
      if: ":extractedCode.result.code",
      agent: "validateMulmoScriptAgent",
      params: { failOnError: false },
      inputs: {
        text: ":extractedCode.result.code",
      },
    },
    // 検証成功時にファイルに保存
    writeJSON: {
      if: ":validateScript.result.isValid",
      agent: "fileWriteAgent",
      params: { failOnError: false },
      inputs: {
        file: "./tmp/script.json",
        text: ":extractedCode.result.code",
      },
      console: { after: true }, // 保存結果をコンソールに表示
    },
  },
};

const main = async () => {
  const urlsFromArgs = process.argv.slice(2);

  if (urlsFromArgs.length === 0) {
    console.error("Usage: pnpm run seed:url <url1> [url2] ...");
    process.exit(1);
  }

  const validatedUrls: string[] = [];
  const invalidArgs: string[] = [];
  for (const arg of urlsFromArgs) {
    try {
      urlSchema.parse(arg);
      validatedUrls.push(arg);
    } catch (e) {
      if (e instanceof z.ZodError) {
          console.warn(`Skipping invalid argument: ${arg} - ${e.errors.map(err => err.message).join(', ')}`);
      } else {
          console.warn(`Skipping argument due to unexpected error: ${arg}`);
      }
      invalidArgs.push(arg);
    }
  }

  if (validatedUrls.length === 0) {
      console.error("No valid URLs provided.");
      process.exit(1);
  }

  console.log(`処理を開始します。URLs: ${validatedUrls.join(', ')}`);

  // GraphAIにエージェントを登録
  const graph = new GraphAI(graphData, {
    ...agents,
    fileWriteAgent,
    browserlessAgent,
    [validateMulmoScriptAgentInfo.name]: validateMulmoScriptAgentInfo.agent
  });

  // 検証済みのURLリストをGraphAIに注入
  graph.injectValue("urls", validatedUrls);

  try {
    // 実行
    await graph.run();
    console.log("処理が完了しました。");
  } catch (error) {
    console.error("エラーが発生しました:", error);
    process.exitCode = 1;
  }
};

main();

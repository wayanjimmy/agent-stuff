import { Type, type Static } from "@sinclair/typebox";

export const WebSearchParams = Type.Object({
  query: Type.String({
    description: "The search query to execute",
  }),
  search_depth: Type.Optional(
    Type.Union(
      [Type.Literal("basic"), Type.Literal("advanced")],
      {
        description: "Search depth level - basic is faster, advanced is more thorough",
        default: "basic",
      }
    )
  ),
  max_results: Type.Optional(
    Type.Number({
      description: "Maximum number of results to return (1-50)",
      minimum: 1,
      maximum: 50,
      default: 10,
    })
  ),
  include_answer: Type.Optional(
    Type.Boolean({
      description: "Include an AI-generated answer based on search results",
      default: true,
    })
  ),
  include_raw_content: Type.Optional(
    Type.Boolean({
      description: "Include full raw content from web pages (increases token usage)",
      default: false,
    })
  ),
  days: Type.Optional(
    Type.Number({
      description: "Limit results to the past N days",
      minimum: 1,
      default: 3,
    })
  ),
  topic: Type.Optional(
    Type.Union(
      [Type.Literal("general"), Type.Literal("news")],
      {
        description: "Type of search - general for web, news for recent articles",
        default: "general",
      }
    )
  ),
});

export type WebSearchParamsType = Static<typeof WebSearchParams>;

// 每只手的名字、说明、参数 —— 跟上一层 mcp_server.py 的 TOOLS 一字不差（npm run conformance 会对一遍）。
// 改说明先改 mcp_server.py，再照抄过来。
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOLS: ToolDef[] = [
  {
    "name": "food_note",
    "description": "把 Ta（跟你说话的那个人）吃的一顿记进「吃了吗」本子。Ta 说吃了什么——外卖、出去吃、自己煮的、随手垫的都算——就用它当场记，记完短短说一句就行。好吃难吃 Ta 没说就别替 Ta 打分。从店里来的写 shop＋city（城市必填，不同城市的雷分开放）；不是店里的写 place（家里、学校、朋友家）。slot 不知道就别填（按现在几点猜）。店名、菜名照 Ta 的原话抄；Ta 对这顿的评价、吐槽放 note（原话）；只是让你「记一下」没评价，就不写 note。先记了、吃完才说好不好吃，用 food_rate 改，别再记一顿。",
    "inputSchema": {
      "type": "object",
      "properties": {
        "dishes": {
          "type": "array",
          "description": "吃了什么，一道一项",
          "items": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "description": "菜名，照 Ta 说的"
              },
              "verdict": {
                "type": "string",
                "enum": [
                  "好吃",
                  "一般",
                  "踩雷"
                ],
                "description": "Ta 说了才填"
              },
              "price": {
                "type": "number"
              },
              "note": {
                "type": "string",
                "description": "Ta 对这道菜的原话"
              }
            },
            "required": [
              "name"
            ]
          }
        },
        "shop": {
          "type": "string",
          "description": "店名（从店里来的才写），照 Ta 说的原名"
        },
        "cuisine": {
          "type": "string",
          "description": "菜系，知道才写"
        },
        "city": {
          "type": "string",
          "description": "哪座城市。不写＝页面上设的那座"
        },
        "area": {
          "type": "string",
          "description": "哪个区 / 哪家分店，知道才写"
        },
        "platform": {
          "type": "string",
          "description": "外卖平台，知道才写"
        },
        "how": {
          "type": "string",
          "enum": [
            "外卖",
            "堂食",
            "自取"
          ],
          "description": "从店里来的才写"
        },
        "place": {
          "type": "string",
          "description": "不是店里的：在哪吃（家里、学校、朋友家…）"
        },
        "slot": {
          "type": "string",
          "enum": [
            "早饭",
            "午饭",
            "晚饭",
            "夜宵",
            "纯记录"
          ],
          "description": "不写就按一个钟头以前猜。纯记录＝不算哪一顿，Ta 想起来随手记的（「那家的 XX 好吃」）"
        },
        "date": {
          "type": "string",
          "description": "YYYY-MM-DD，不写＝今天"
        },
        "verdict": {
          "type": "string",
          "enum": [
            "好吃",
            "一般",
            "踩雷"
          ],
          "description": "这一顿整体，Ta 说了才填"
        },
        "total": {
          "type": "number",
          "description": "这顿一共多少钱"
        },
        "currency": {
          "type": "string",
          "enum": [
            "CNY",
            "AUD",
            "USD",
            "JPY",
            "GBP",
            "EUR"
          ],
          "description": "不写：按城市猜"
        },
        "note": {
          "type": "string",
          "description": "Ta 对这一顿的评价、吐槽（原话）；没评价就不写"
        }
      },
      "required": []
    }
  },
  {
    "name": "food_taste",
    "description": "「吃了吗」里那张不记日期的口味单：爱吃 / 不爱吃 / 不能吃（过敏、忌口）。Ta 说「我最爱 XX」「我不吃 XX」「XX 我过敏」这种不挂哪一顿的话，就用它记；一句里说了好几样就放 items 一次记。癖好、搭配用 scope：「炒菜里不要姜葱蒜」＝不爱吃 · 姜葱蒜 · scope 炒菜；「面要加麻油」＝爱吃 · 麻油 · scope 面；scope 空＝什么菜都算。爱吃但 Ta 现在吃不到的，away=true。同一样又配同一类菜再记＝挪档。kind=拿掉 是从单子上删掉。item 照 Ta 的原话抄，备注放 note。记完短短说一句。",
    "inputSchema": {
      "type": "object",
      "properties": {
        "item": {
          "type": "string",
          "description": "哪一样吃的，照 Ta 说的"
        },
        "items": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "一句里说了好几样：一次记一串（同一档、同一个 scope）"
        },
        "kind": {
          "type": "string",
          "enum": [
            "爱吃",
            "不爱吃",
            "不能吃",
            "拿掉"
          ]
        },
        "scope": {
          "type": "string",
          "description": "配哪类菜（炒菜、面…）；不写＝什么菜都算"
        },
        "away": {
          "type": "boolean",
          "description": "爱吃但现在吃不到"
        },
        "note": {
          "type": "string",
          "description": "一句备注（过敏、只吃红汤…），没有就不写"
        }
      },
      "required": [
        "kind"
      ]
    }
  },
  {
    "name": "food_book",
    "description": "翻「吃了吗」本子。最上面是：今天吃了没、上一顿离现在多久、口味单 —— Ta 一天没吃东西、或者问你吃什么好的时候先翻，推荐吃的、帮 Ta 点外卖、Ta 问「我最近吃了啥」「那家我吃过吗」之前也先翻，别凭印象说店名。不写 city 就按页面上设的那座城。view：recent 这几天吃了啥 · often 常吃的 · bad 拉黑的店和踩过的雷 · shop 查一家店（配 q）· 不写＝三样各给一点。",
    "inputSchema": {
      "type": "object",
      "properties": {
        "view": {
          "type": "string",
          "enum": [
            "recent",
            "often",
            "bad",
            "shop"
          ]
        },
        "city": {
          "type": "string",
          "description": "哪座城市；写「全部」看所有城市"
        },
        "q": {
          "type": "string",
          "description": "view=shop 时：店名里的几个字"
        },
        "days": {
          "type": "integer",
          "description": "view=recent 时往回翻几天，默认 7"
        }
      },
      "required": []
    }
  },
  {
    "name": "food_dice",
    "description": "「这顿吃什么」的骰子：Ta 纠结吃什么、让你帮着挑、说「你丢一个」的时候用。照口味单先剔（不能吃的整道剔、不爱吃的主料剔、写了菜系的整个菜系剔），再随机丢。mode=way 只丢一个方向（川菜、日料…），dish 丢一道具体的菜。Ta 说今天特别想吃什么（鸡、面、川菜…）就放进 want，会往那边偏。丢完把结果和提醒（备注不要葱这种）原样说给 Ta，别自己另编一道。",
    "inputSchema": {
      "type": "object",
      "properties": {
        "mode": {
          "type": "string",
          "enum": [
            "dish",
            "way"
          ],
          "description": "dish 一道菜（默认）；way 一个方向"
        },
        "kind": {
          "type": "string",
          "enum": [
            "饭",
            "面粉",
            "菜",
            "汤粥",
            "小吃",
            "锅"
          ],
          "description": "只在这一类里丢，Ta 说了才写"
        },
        "want": {
          "type": "string",
          "description": "Ta 今天特别想吃的：一样东西（鸡、牛蛙）或一个菜系（川菜）"
        }
      },
      "required": []
    }
  },
  {
    "name": "food_rate",
    "description": "改评价：已经记好的一顿，Ta 吃完才说好不好吃（「酸豆角好吃」「米饭有点硬」），或者想改之前的评价，就用它改到那一顿上，别再记一顿。默认改最近那一顿里叫这个名字的菜；说了哪天、哪家就写 date、shop。dish 不写＝改这一顿整体。同一道菜以前好吃过、这次踩雷（或反过来），回执里会写「时好时坏」和日子 —— 原样告诉 Ta，以后推荐这道也先提醒。",
    "inputSchema": {
      "type": "object",
      "properties": {
        "dish": {
          "type": "string",
          "description": "哪道菜，照 Ta 说的；不写＝这一顿整体"
        },
        "verdict": {
          "type": "string",
          "enum": [
            "好吃",
            "一般",
            "踩雷"
          ]
        },
        "note": {
          "type": "string",
          "description": "Ta 说的那句（原话），没有就不写"
        },
        "shop": {
          "type": "string",
          "description": "哪家，Ta 说了才写"
        },
        "date": {
          "type": "string",
          "description": "YYYY-MM-DD，Ta 说了是哪天才写；不写＝最近那一顿"
        }
      },
      "required": []
    }
  },
  {
    "name": "food_page",
    "description": "Ta 想看本子、问「在哪看」「给我链接」的时候，把「吃了吗」页面的地址给 Ta。在页面上能记、改、删。地址只发给 Ta 本人。",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": []
    }
  }
];

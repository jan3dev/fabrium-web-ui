import { describe, expect, it } from "vitest";
import {
  areaTarget,
  BOARD_LIMITS,
  type Board,
  boardCommentTarget,
  boardHas,
  boardTargetOf,
  nodeAt,
  reverseEdge,
  setEdge,
  composeBoardRequest,
  connect,
  deleteEdge,
  deleteNodes,
  edgePoint,
  editBoard,
  findBoardAssets,
  groupIntoSection,
  moveNodes,
  newNode,
  addNode,
  nextId,
  readBoard,
  resizeNode,
  setNodeColor,
  setNodeText,
} from "./whiteboard";

const MXC = "mxc://example.org/abc123";

const BOARD = `{
  "nodes": [
    { "id": "s1", "type": "section", "x": 0, "y": 0, "w": 400, "h": 300, "text": "Ideas" },
    { "id": "a", "type": "note", "x": 20, "y": 40, "w": 100, "h": 100, "text": "One", "color": "yellow" },
    { "id": "b", "type": "shape", "x": 600, "y": 40, "w": 100, "h": 60, "shape": "oval" }
  ],
  "edges": [{ "from": "a", "to": "b", "label": "leads to" }]
}
`;
const board = () => readBoard(BOARD)!;

describe("readBoard", () => {
  it("reads a board and keeps only what is valid", () => {
    expect(board()).toEqual({
      nodes: [
        { id: "s1", type: "section", x: 0, y: 0, w: 400, h: 300, text: "Ideas" },
        { id: "a", type: "note", x: 20, y: 40, w: 100, h: 100, text: "One", color: "yellow" },
        { id: "b", type: "shape", x: 600, y: 40, w: 100, h: 60, shape: "oval" },
      ],
      edges: [{ from: "a", to: "b", label: "leads to" }],
    });
  });

  it("is null for anything that is not a JSON object, and never throws", () => {
    expect(readBoard("{not json")).toBeNull();
    expect(readBoard("[]")).toBeNull();
    expect(readBoard("null")).toBeNull();
    expect(readBoard("{}")).toEqual({ nodes: [], edges: [] });
    expect(readBoard(`{"nodes":"x","edges":{}}`)).toEqual({ nodes: [], edges: [] });
  });

  it("drops invalid nodes, duplicates and edges to unknown ids; clamps numbers and strings", () => {
    const b = readBoard(
      JSON.stringify({
        nodes: [
          { id: "ok", type: "note", x: 1e9, y: -1e9, w: 1, h: 1e9, text: "t".repeat(3000), color: "teal" },
          { id: "ok", type: "text", x: 0, y: 0, w: 10, h: 10 },
          { id: "bad id!", type: "note", x: 0, y: 0, w: 10, h: 10 },
          { id: "x".repeat(65), type: "note", x: 0, y: 0, w: 10, h: 10 },
          { id: "nan", type: "note", x: "1", y: 0, w: 10, h: 10 },
          { id: "inf", type: "note", x: Infinity, y: 0, w: 10, h: 10 },
          { id: "kind", type: "html", x: 0, y: 0, w: 10, h: 10 },
          { id: "img", type: "image", x: 0, y: 0, w: 10, h: 10, mxc: "https://evil.example/x.png", shape: "oval" },
          { id: "pic", type: "image", x: 0, y: 0, w: 10, h: 10, mxc: MXC },
          { id: "s", type: "note", x: 0, y: 0, w: 10, h: 10, shape: "oval" },
          "nope",
        ],
        edges: [
          { from: "ok", to: "pic", label: "l".repeat(300), arrow: "both" },
          { from: "ok", to: "ghost" },
          { from: "ok", to: "ok" },
          { from: "ok", to: "img", arrow: "sideways" },
          { from: 1, to: "ok" },
        ],
      }),
    )!;
    expect(b.nodes.map((n) => n.id)).toEqual(["ok", "img", "pic", "s"]);
    const ok = b.nodes[0]!;
    expect([ok.x, ok.y, ok.w, ok.h]).toEqual([100_000, -100_000, 8, 10_000]);
    expect(ok.text).toHaveLength(2000);
    expect(ok.color).toBeUndefined();
    expect(b.nodes[1]).toEqual({ id: "img", type: "image", x: 0, y: 0, w: 10, h: 10 });
    expect(b.nodes[2]!.mxc).toBe(MXC);
    expect(b.nodes[3]!.shape).toBeUndefined();
    expect(b.edges).toEqual([
      { from: "ok", to: "pic", label: "l".repeat(200), arrow: "both" },
      { from: "ok", to: "img" },
    ]);
  });

  it("caps nodes and edges", () => {
    const nodes = Array.from({ length: 600 }, (_, i) => ({ id: `n${i}`, type: "note", x: 0, y: 0, w: 10, h: 10 }));
    const edges = Array.from({ length: 1200 }, (_, i) => ({ from: "n0", to: `n${(i % 499) + 1}` }));
    const b = readBoard(JSON.stringify({ nodes, edges }))!;
    expect(b.nodes).toHaveLength(500);
    expect(b.edges).toHaveLength(1000);
  });

  it("lists the images and videos by URI", () => {
    const text = JSON.stringify({
      nodes: [
        { id: "v", type: "video", x: 0, y: 0, w: 10, h: 10, mxc: MXC },
        { id: "i", type: "image", x: 0, y: 0, w: 10, h: 10, mxc: "mxc://example.org/img" },
      ],
    });
    expect([...findBoardAssets(text)]).toEqual([
      [MXC, "video"],
      ["mxc://example.org/img", "image"],
    ]);
    expect(findBoardAssets("{nope").size).toBe(0);
  });
});

describe("edits", () => {
  it("moves a section with its members, rounded and clamped", () => {
    const moved = moveNodes(board(), ["s1"], 10.4, -5);
    expect(moved.nodes.map((n) => [n.id, n.x, n.y])).toEqual([
      ["s1", 10, -5],
      ["a", 30, 35],
      ["b", 600, 40],
    ]);
    expect(moveNodes(board(), ["b"], 1e9, 0).nodes[2]!.x).toBe(100_000);
    const b = board();
    expect(moveNodes(b, ["a"], 0, 0)).toBe(b);
  });

  it("resizes, retypes and recolors", () => {
    expect(resizeNode(board(), "a", 2, 20_000).nodes[1]).toMatchObject({ w: 8, h: 10_000 });
    expect(setNodeText(board(), "a", "Two").nodes[1]!.text).toBe("Two");
    expect(setNodeText(board(), "a", "").nodes[1]).not.toHaveProperty("text");
    expect(setNodeColor(board(), ["a", "b"], "blue").nodes.map((n) => n.color)).toEqual([undefined, "blue", "blue"]);
    expect(setNodeColor(board(), ["a"], null).nodes[1]).not.toHaveProperty("color");
    const b = board();
    expect(setNodeText(b, "a", "One")).toBe(b);
    expect(setNodeText(b, "ghost", "x")).toBe(b);
  });

  it("connects two nodes once, and deletes nodes with their edges", () => {
    const b = board();
    expect(connect(b, "b", "a")).toBe(b);
    expect(connect(b, "a", "a")).toBe(b);
    expect(connect(b, "a", "ghost")).toBe(b);
    expect(connect(b, "s1", "b").edges.at(-1)).toEqual({ from: "s1", to: "b" });
    const gone = deleteNodes(b, ["a"]);
    expect(gone.nodes.map((n) => n.id)).toEqual(["s1", "b"]);
    expect(gone.edges).toEqual([]);
    // A deleted section leaves its members.
    expect(deleteNodes(b, ["s1"]).nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(deleteEdge(b, 0).edges).toEqual([]);
    expect(deleteEdge(b, 5)).toBe(b);
  });

  it("adds nodes with fresh ids; a section goes under the rest", () => {
    const b = board();
    expect(nextId(b)).toBe("n4");
    const note = newNode(b, "note", { x: 100, y: 100 }, { text: "Hi" });
    expect(note).toEqual({ id: "n4", type: "note", x: 0, y: 20, w: 200, h: 160, text: "Hi" });
    expect(addNode(b, note).nodes.at(-1)).toEqual(note);
    expect(addNode(b, { ...note, id: "a" }).nodes.at(-1)!.id).toBe("n4");
    expect(addNode(b, newNode(b, "section", { x: 0, y: 0 })).nodes[0]!.type).toBe("section");
    const full: Board = { nodes: Array.from({ length: 500 }, (_, i) => ({ ...note, id: `x${i}` })), edges: [] };
    expect(() => addNode(full, note)).toThrow(/at most 500/);
  });

  it("groups nodes into a new section that holds them", () => {
    const g = groupIntoSection(board(), ["a", "b"], "g1", "Plan");
    const section = g.nodes[0]!;
    expect(section).toMatchObject({ id: "g1", type: "section", text: "Plan", x: -20, y: -20 });
    // Moving the section moves both.
    expect(moveNodes(g, ["g1"], 5, 0).nodes.filter((n) => n.id === "a" || n.id === "b").map((n) => n.x)).toEqual([25, 605]);
    const b = board();
    expect(groupIntoSection(b, [], "g1")).toBe(b);
  });

  it("edits the text in its indent and leaves it alone when nothing changed", () => {
    const edited = editBoard(BOARD, (b) => setNodeText(b, "a", "Two"));
    expect(edited).toMatch(/^\{\n {2}"nodes"/);
    expect(edited.endsWith("}\n")).toBe(true);
    expect(readBoard(edited)!.nodes[1]!.text).toBe("Two");
    expect(editBoard(BOARD, (b) => setNodeText(b, "a", "One"))).toBe(BOARD);
    expect(() => editBoard("[]", (b) => b)).toThrow(/not a JSON object/);
  });

  it("writes an edit onto the source JSON and keeps what the reader dropped", () => {
    const long = "x".repeat(BOARD_LIMITS.text + 500);
    const source = JSON.stringify({
      meta: { by: "agent" },
      nodes: [
        { id: "a", type: "note", x: 0, y: 0, w: 100, h: 100, text: long, font: "mono" },
        { id: 7, type: "note", x: 0, y: 0, w: 100, h: 100 },
        { id: "b", type: "note", x: 300, y: 0, w: 100, h: 100, color: "red" },
      ],
      edges: [{ from: "a", to: "b", weight: 3 }, { from: "a", to: "gone" }],
    });
    const moved = JSON.parse(editBoard(source, (b) => moveNodes(b, ["a"], 10, 0)));
    expect(moved.meta).toEqual({ by: "agent" });
    expect(moved.nodes[0]).toEqual({ id: "a", type: "note", x: 10, y: 0, w: 100, h: 100, text: long, font: "mono" });
    expect(moved.nodes.map((n: { id: unknown }) => n.id)).toEqual(["a", "b", 7]);
    expect(moved.edges).toEqual([{ from: "a", to: "b", weight: 3 }, { from: "a", to: "gone" }]);

    // A removed field goes, a reversed connection keeps its own fields, a deleted node takes its edges along.
    const plain = JSON.parse(editBoard(source, (b) => reverseEdge(setNodeColor(b, ["b"], null), 0)));
    expect(plain.nodes[1]).toEqual({ id: "b", type: "note", x: 300, y: 0, w: 100, h: 100 });
    expect(plain.edges[0]).toEqual({ from: "b", to: "a", weight: 3 });
    const less = JSON.parse(editBoard(source, (b) => deleteNodes(b, ["b"])));
    expect(less.nodes.map((n: { id: unknown }) => n.id)).toEqual(["a", 7]);
    expect(less.edges).toEqual([{ from: "a", to: "gone" }]);
  });
});

describe("connections", () => {
  it("reads style and color, and drops unknown values to the default", () => {
    const b = readBoard(
      JSON.stringify({
        nodes: board().nodes,
        edges: [
          { from: "a", to: "b", style: "dashed", color: "red", arrow: "both" },
          { from: "b", to: "a", style: "wavy", color: "#f00" },
        ],
      }),
    )!;
    expect(b.edges).toEqual([
      { from: "a", to: "b", arrow: "both", style: "dashed", color: "red" },
      { from: "b", to: "a" },
    ]);
  });

  it("sets the arrowheads, style, color and label, leaving defaults out", () => {
    let b = setEdge(board(), 0, { style: "dotted", color: "blue", arrow: "none" });
    expect(b.edges[0]).toEqual({ from: "a", to: "b", label: "leads to", arrow: "none", style: "dotted", color: "blue" });
    b = setEdge(b, 0, { style: "solid", color: null, arrow: "end", label: "  then \n next " });
    expect(b.edges[0]).toEqual({ from: "a", to: "b", label: "then next" });
    expect(setEdge(b, 0, { label: "" }).edges[0]).toEqual({ from: "a", to: "b" });
    expect(setEdge(b, 0, { label: "x".repeat(300) }).edges[0]!.label).toHaveLength(200);
    // Unchanged or out of range: the same board.
    expect(setEdge(b, 0, { label: "then next" })).toBe(b);
    expect(setEdge(b, 5, { style: "dashed" })).toBe(b);
  });

  it("reverses a connection, keeping its other fields", () => {
    const b = reverseEdge(setEdge(board(), 0, { style: "dashed" }), 0);
    expect(b.edges[0]).toEqual({ from: "b", to: "a", label: "leads to", style: "dashed" });
    expect(reverseEdge(b, 3)).toBe(b);
  });

  it("finds the topmost node under a point, a section last", () => {
    expect(nodeAt(board(), { x: 50, y: 50 })).toBe("a");
    expect(nodeAt(board(), { x: 300, y: 250 })).toBe("s1");
    expect(nodeAt(board(), { x: 50, y: 50 }, "a")).toBe("s1");
    expect(nodeAt(board(), { x: 2000, y: 0 })).toBeNull();
  });
});

describe("comments", () => {
  it("names a node or a connection for the agent, and finds it again", () => {
    const node = boardCommentTarget(board(), { node: "a" });
    expect(node).toEqual({ kind: "text", where: "whiteboard node a", text: 'Note "One" (id a)' });
    const edge = boardCommentTarget(board(), { from: "b", to: "a" });
    expect(edge).toEqual({
      kind: "text",
      where: "whiteboard connection a -> b",
      text: 'Connection from note "One" (id a) to shape (id b), label "leads to"',
    });
    expect(boardTargetOf(node!)).toEqual({ node: "a" });
    expect(boardTargetOf(edge!)).toEqual({ from: "a", to: "b" });
    expect(boardTargetOf(areaTarget(board(), ["a"]))).toBeNull();
    expect(boardCommentTarget(board(), { node: "gone" })).toBeNull();
  });

  it("knows when the target is gone", () => {
    expect(boardHas(board(), { node: "a" })).toBe(true);
    expect(boardHas(deleteNodes(board(), ["a"]), { node: "a" })).toBe(false);
    expect(boardHas(reverseEdge(board(), 0), { from: "a", to: "b" })).toBe(true);
    expect(boardHas(deleteEdge(board(), 0), { from: "a", to: "b" })).toBe(false);
  });
});

describe("geometry and requests", () => {
  it("puts an edge's end on the box's border", () => {
    expect(edgePoint({ x: 0, y: 0, w: 100, h: 50 }, { x: 500, y: 25 })).toEqual({ x: 100, y: 25 });
    expect(edgePoint({ x: 0, y: 0, w: 100, h: 50 }, { x: 50, y: -100 })).toEqual({ x: 50, y: 0 });
  });

  it("names the area's nodes in a text reference", () => {
    expect(areaTarget(board(), ["a", "b", "ghost"])).toEqual({
      kind: "text",
      where: "whiteboard area, 2 nodes",
      text: "- a (note): One\n- b (shape)",
    });
  });

  it("phrases each request with the artifact's identifier", () => {
    for (const r of ["reorganize", "gaps", "deck", "document"] as const)
      expect(composeBoardRequest(r, "roadmap")).toContain("`roadmap`");
  });
});

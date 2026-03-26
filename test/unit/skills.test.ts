/**
 * 业务职责：Skill 单测确保开源扩展入口的 manifest 解析、参数补齐和模板渲染可预测，
 * 避免用户新增 skill 后在 CLI 或 MCP 里出现行为分叉。
 */
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSkill, renderSkillPrompt, resolveSkillInputs } from "../../src/skills/skill.js";

describe("skills", () => {
  let tempRoot = "";

  afterEach(async () => {
    if (tempRoot) {
      await import("node:fs/promises").then(({ rm }) => rm(tempRoot, { recursive: true, force: true }));
      tempRoot = "";
    }
  });

  /**
   * 业务职责：验证 skill.yaml 能正确解析成公共格式，保障仓库内外扩展都走同一套契约。
   */
  it("loads skill manifest", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "skill-test-"));
    const skillDir = path.join(tempRoot, "demo");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "skill.yaml"),
      "name: demo\ndescription: demo skill\ninputs:\n  topic:\n    description: demo topic\noutputContract: deliver\n",
      "utf8"
    );
    await writeFile(path.join(skillDir, "prompt.md"), "Topic: {{topic}}\n", "utf8");

    const definition = await loadSkill("demo", tempRoot);
    expect(definition.manifest.name).toBe("demo");
    expect(definition.manifest.inputs.topic.description).toBe("demo topic");
  });

  /**
   * 业务职责：验证模板变量会被具体输入替换，确保 skill 执行最后仍然产出真实任务文本。
   */
  it("renders prompt template", () => {
    expect(renderSkillPrompt("Hello {{name}}", { name: "Codex" })).toBe("Hello Codex");
  });

  /**
   * 业务职责：验证 skill 输入在非交互模式下也会正确应用默认值，确保配方能在 CLI 和 MCP 中一致复用。
   */
  it("resolves default skill inputs", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "skill-test-"));
    const skillDir = path.join(tempRoot, "demo");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "skill.yaml"),
      "name: demo\ndescription: demo skill\ninputs:\n  topic:\n    description: demo topic\n    default: preset\noutputContract: deliver\n",
      "utf8"
    );
    await writeFile(path.join(skillDir, "prompt.md"), "Topic: {{topic}}\n", "utf8");

    const definition = await loadSkill("demo", tempRoot);
    const values = await resolveSkillInputs(definition, {}, false);

    expect(values.topic).toBe("preset");
  });
});

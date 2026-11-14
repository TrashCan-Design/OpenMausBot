import { describe, expect, it } from "vitest";
import { compileToolSchema } from "./mcp-schema-validator.ts";
describe("strict implicit MCP schema dialects", () => {
  it("enforces an implicit 2020-12 dependency without changing arguments", () => {
    const validate = compileToolSchema({ type: "object", properties: { value: { type: "string" }, unit: { type: "string" } }, dependentRequired: { value: ["unit"] }, additionalProperties: false });
    const args = { value: "12" }; expect(validate(args)).toBe(false); expect(args).toEqual({ value: "12" });
    expect(validate({ value: "12", unit: "px" })).toBe(true);
    expect(validate({ value: 12, unit: "px" })).toBe(false);
  });
  it.each([
    { type: "object", unknownConstraint: true },
    { type: "object", properties: { x: { $ref: "https://example.invalid/remote" } } },
    { $schema: "https://example.invalid/schema", type: "object" },
  ])("fails closed for unsupported constraints and references %#", schema => {
    expect(() => compileToolSchema(schema)).toThrow();
  });
});

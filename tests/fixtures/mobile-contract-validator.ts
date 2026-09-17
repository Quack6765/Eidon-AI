import fs from "node:fs";
import path from "node:path";

import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";

type JsonRecord = Record<string, unknown>;

const openApi = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "contracts/mobile-api-v1.openapi.json"), "utf8")
) as JsonRecord;
const websocketSchema = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), "contracts/mobile-api-v1.websocket.schema.json"),
    "utf8"
  )
) as JsonRecord;

function createAjv() {
  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strict: false
  });
  addFormats(ajv);
  return ajv;
}

function resolveLocalRef(document: JsonRecord, ref: string) {
  if (!ref.startsWith("#/")) {
    throw new Error(`Only local contract references are supported: ${ref}`);
  }
  return ref
    .slice(2)
    .split("/")
    .reduce<unknown>((value, key) => (value as JsonRecord)?.[key], document);
}

function formatErrors(validate: ValidateFunction) {
  return createAjv().errorsText(validate.errors, { separator: "; " });
}

const openApiAjv = createAjv();
const responseValidators = new Map<string, ValidateFunction>();

function getOperation(pathname: string, method: string) {
  const paths = openApi.paths as JsonRecord;
  const pathItem = paths[pathname] as JsonRecord | undefined;
  const operation = pathItem?.[method.toLowerCase()] as JsonRecord | undefined;
  if (!operation) {
    throw new Error(`OpenAPI operation is missing: ${method.toUpperCase()} ${pathname}`);
  }
  return operation;
}

function getResponseSchema(pathname: string, method: string, status: number) {
  const operation = getOperation(pathname, method);
  const responses = operation.responses as JsonRecord;
  let response = responses[String(status)] as JsonRecord | undefined;
  if (!response) {
    throw new Error(
      `OpenAPI response is missing: ${method.toUpperCase()} ${pathname} ${status}`
    );
  }
  if (typeof response.$ref === "string") {
    response = resolveLocalRef(openApi, response.$ref) as JsonRecord;
  }
  const content = response.content as JsonRecord | undefined;
  const json = content?.["application/json"] as JsonRecord | undefined;
  return json?.schema as JsonRecord | undefined;
}

function getRequestBodySchema(pathname: string, method: string) {
  const operation = getOperation(pathname, method);
  let requestBody = operation.requestBody as JsonRecord | undefined;
  if (typeof requestBody?.$ref === "string") {
    requestBody = resolveLocalRef(openApi, requestBody.$ref) as JsonRecord;
  }
  const content = requestBody?.content as JsonRecord | undefined;
  const json = content?.["application/json"] as JsonRecord | undefined;
  return json?.schema as JsonRecord | undefined;
}

function assertAgainstSchema(
  validators: Map<string, ValidateFunction>,
  key: string,
  schema: JsonRecord,
  body: unknown
) {
  let validate = validators.get(key);
  if (!validate) {
    validate = openApiAjv.compile({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      ...schema,
      components: openApi.components
    });
    validators.set(key, validate);
  }
  if (!validate(body)) {
    throw new Error(`${key} failed contract validation: ${formatErrors(validate)}`);
  }
}

export function assertOpenApiResponse(
  pathname: string,
  method: string,
  status: number,
  body: unknown
) {
  const key = `${method.toUpperCase()} ${pathname} ${status}`;
  const schema = getResponseSchema(pathname, method, status);
  if (!schema) {
    throw new Error(`OpenAPI JSON response schema is missing: ${key}`);
  }
  assertAgainstSchema(responseValidators, key, schema, body);
}

const requestBodyValidators = new Map<string, ValidateFunction>();

export function assertOpenApiRequestBody(pathname: string, method: string, body: unknown) {
  const key = `${method.toUpperCase()} ${pathname} request body`;
  const schema = getRequestBodySchema(pathname, method);
  if (!schema) {
    throw new Error(`OpenAPI JSON request body schema is missing: ${key}`);
  }
  assertAgainstSchema(requestBodyValidators, key, schema, body);
}

export function compileOpenApiJsonResponses() {
  const paths = openApi.paths as JsonRecord;
  let compiled = 0;
  for (const [pathname, pathValue] of Object.entries(paths)) {
    for (const [method, operationValue] of Object.entries(pathValue as JsonRecord)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const operation = operationValue as JsonRecord;
      const responses = operation.responses as JsonRecord;
      for (const status of Object.keys(responses)) {
        const schema = getResponseSchema(pathname, method, Number(status));
        if (!schema) continue;
        openApiAjv.compile({
          $schema: "https://json-schema.org/draft/2020-12/schema",
          ...schema,
          components: openApi.components
        });
        compiled += 1;
      }
    }
  }
  return compiled;
}

export function compileOpenApiJsonRequestBodies() {
  const paths = openApi.paths as JsonRecord;
  let compiled = 0;
  for (const [pathname, pathValue] of Object.entries(paths)) {
    for (const method of Object.keys(pathValue as JsonRecord)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const schema = getRequestBodySchema(pathname, method);
      if (!schema) continue;
      openApiAjv.compile({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        ...schema,
        components: openApi.components
      });
      compiled += 1;
    }
  }
  return compiled;
}

const websocketAjv = createAjv();
const websocketValidators = new Map<string, ValidateFunction>();

export function assertWebSocketMessage(
  kind: "ClientMessage" | "ServerMessage",
  message: unknown
) {
  let validate = websocketValidators.get(kind);
  if (!validate) {
    validate = websocketAjv.compile({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $ref: `#/$defs/${kind}`,
      $defs: websocketSchema.$defs
    });
    websocketValidators.set(kind, validate);
  }
  if (!validate(message)) {
    throw new Error(`${kind} failed contract validation: ${formatErrors(validate)}`);
  }
}

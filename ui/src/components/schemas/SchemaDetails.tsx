import { Button, Card, Row, Space, Typography, message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { generatePath, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

import { APIError } from "src/adapters/api";
import { getSchema } from "src/adapters/api/schemas";
import { downloadJsonFromUrl } from "src/adapters/json";
import { getSchemaFromUrl, getSchemaJsonLdTypes } from "src/adapters/schemas";
import { ReactComponent as CreditCardIcon } from "src/assets/icons/credit-card-plus.svg";
import { Detail } from "src/components/schemas/Detail";
import { SchemaViewer } from "src/components/schemas/SchemaViewer";
import { ErrorResult } from "src/components/shared/ErrorResult";
import { LoadingResult } from "src/components/shared/LoadingResult";
import { SiderLayoutContent } from "src/components/shared/SiderLayoutContent";
import { useEnvContext } from "src/contexts/env";
import { Json, JsonLdType } from "src/domain";
import { JsonSchema } from "src/domain/jsonSchema";
import { Schema } from "src/domain/schema";
import { ROUTES } from "src/routes";
import { AsyncTask, hasAsyncTaskFailed, isAsyncTaskStarting } from "src/utils/async";
import { isAbortedError, makeRequestAbortable } from "src/utils/browser";
import { processZodError } from "src/utils/error";
import { formatDate } from "src/utils/forms";

export function SchemaDetails() {
  const navigate = useNavigate();
  const { schemaID } = useParams();

  const env = useEnvContext();

  const [jsonSchemaTuple, setJsonSchemaTuple] = useState<
    AsyncTask<[JsonSchema, Json], string | z.ZodError>
  >({
    status: "pending",
  });
  const [apiSchema, setApiSchema] = useState<AsyncTask<Schema, APIError>>({
    status: "pending",
  });
  const [contextTuple, setContextTuple] = useState<
    AsyncTask<[JsonLdType, Json], string | z.ZodError>
  >({
    status: "pending",
  });

  const extractError = (error: unknown) =>
    error instanceof z.ZodError ? error : error instanceof Error ? error.message : "Unknown error";

  const fetchSchemaFromUrl = useCallback((apiSchema: Schema): void => {
    setJsonSchemaTuple({ status: "loading" });

    getSchemaFromUrl({
      url: apiSchema.url,
    })
      .then(([jsonSchema, rawJsonSchema]) => {
        setJsonSchemaTuple({ data: [jsonSchema, rawJsonSchema], status: "successful" });
        setContextTuple({ status: "loading" });
        getSchemaJsonLdTypes({
          jsonSchema,
        })
          .then(([jsonLdTypes, rawJsonLdContext]) => {
            const jsonLdType = jsonLdTypes.find((type) => type.name === apiSchema.type);

            if (jsonLdType) {
              setContextTuple({ data: [jsonLdType, rawJsonLdContext], status: "successful" });
            } else {
              setContextTuple({
                error:
                  "Couldn't find the type specified by the schemas API in the context of the schema obtained from the URL",
                status: "failed",
              });
            }
          })
          .catch((error) => {
            setContextTuple({
              error: extractError(error),
              status: "failed",
            });
          });
      })
      .catch((error) => {
        setJsonSchemaTuple({
          error: extractError(error),
          status: "failed",
        });
      });
  }, []);

  const fetchApiSchema = useCallback(
    async (signal: AbortSignal) => {
      if (schemaID) {
        setApiSchema({ status: "loading" });

        const response = await getSchema({
          env,
          schemaID,
          signal,
        });

        if (response.isSuccessful) {
          setApiSchema({ data: response.data, status: "successful" });
          fetchSchemaFromUrl(response.data);
        } else {
          if (!isAbortedError(response.error)) {
            setApiSchema({ error: response.error, status: "failed" });
          }
        }
      }
    },
    [env, fetchSchemaFromUrl, schemaID]
  );

  useEffect(() => {
    if (schemaID) {
      const { aborter } = makeRequestAbortable(fetchApiSchema);
      return aborter;
    }
    return;
  }, [fetchApiSchema, schemaID]);

  const contextTupleErrorToString = (error: string | z.ZodError) =>
    error instanceof z.ZodError
      ? [
          "An error occurred while parsing the context referenced in the schema:",
          ...processZodError(error).map((e) => `"${e}"`),
          "Please provide a schema with a valid context.",
        ].join("\n")
      : `An error occurred while downloading the context referenced in the schema:\n"${error}"\nPlease try again.`;

  const schemaTupleErrorToString = (error: string | z.ZodError) =>
    error instanceof z.ZodError
      ? [
          "An error occurred while parsing the schema from the URL:",
          ...processZodError(error).map((e) => `"${e}"`),
          "Please provide a valid schema.",
        ].join("\n")
      : `An error occurred while downloading the schema from the URL:\n"${error}"\nPlease try again.`;

  const loading =
    isAsyncTaskStarting(apiSchema) ||
    isAsyncTaskStarting(jsonSchemaTuple) ||
    isAsyncTaskStarting(contextTuple);

  return (
    <SiderLayoutContent
      description="Schema details include a hash, schema URL and attributes. The schema can be viewed formatted by its attributes, as the JSON LD Context or as a JSON."
      showBackButton
      showDivider
      title="Schema details"
    >
      {(() => {
        if (hasAsyncTaskFailed(apiSchema)) {
          return (
            <Card className="centered">
              <ErrorResult
                error={[
                  "An error occurred while downloading or parsing the schema from the API:",
                  apiSchema.error.message,
                ].join("\n")}
              />
            </Card>
          );
        } else if (hasAsyncTaskFailed(jsonSchemaTuple)) {
          return (
            <Card className="centered">
              <ErrorResult error={schemaTupleErrorToString(jsonSchemaTuple.error)} />
            </Card>
          );
        } else if (hasAsyncTaskFailed(contextTuple)) {
          return (
            <Card className="centered">
              <ErrorResult error={contextTupleErrorToString(contextTuple.error)} />
            </Card>
          );
        } else if (loading) {
          return (
            <Card className="centered">
              <LoadingResult />
            </Card>
          );
        } else {
          const { bigInt, createdAt, hash, url } = apiSchema.data;
          const [jsonSchema, rawJsonSchema] = jsonSchemaTuple.data;
          const [jsonLdType, rawJsonLdContext] = contextTuple.data;

          return (
            <SchemaViewer
              actions={
                <Space size="middle">
                  <Button
                    icon={<CreditCardIcon />}
                    onClick={() => {
                      navigate(generatePath(ROUTES.issueCredential.path, { schemaID }));
                    }}
                    type="primary"
                  >
                    Issue credential
                  </Button>
                </Space>
              }
              contents={
                <Space direction="vertical">
                  <Typography.Text type="secondary">SCHEMA DETAILS</Typography.Text>

                  <Detail copyable data={bigInt} label="BigInt" />

                  <Detail copyable data={hash} label="Hash" />

                  <Detail copyable data={url} label="URL" />

                  <Detail data={formatDate(createdAt, true)} label="Import date" />

                  <Row justify="space-between">
                    <Typography.Text type="secondary">Download</Typography.Text>

                    <Button
                      onClick={() => {
                        downloadJsonFromUrl({
                          fileName: jsonSchema.name,
                          url: url,
                        })
                          .then(() => {
                            void message.success("Schema downloaded successfully.");
                          })
                          .catch(() => {
                            void message.error(
                              "An error occurred while downloading the schema. Please try again."
                            );
                          });
                      }}
                      style={{ height: 24, padding: 0 }}
                      type="link"
                    >
                      JSON Schema
                    </Button>
                  </Row>
                </Space>
              }
              jsonLdType={jsonLdType}
              jsonSchema={jsonSchema}
              rawJsonLdContext={rawJsonLdContext}
              rawJsonSchema={rawJsonSchema}
            />
          );
        }
      })()}
    </SiderLayoutContent>
  );
}

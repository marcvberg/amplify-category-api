'use strict';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { GraphQLTransform, validateModelSchema } from '@aws-amplify/graphql-transformer-core';
import { parse } from 'graphql';
import { PredictionsTransformer } from '..';

test('does not generate any resources if @predictions is unused', () => {
  const schema = `
    type Query {
      speakTranslatedText: String
    }`;
  const transformer = new GraphQLTransform({
    transformers: [new PredictionsTransformer({ bucketName: 'myStorage${hash}-${env}' })],
  });

  const out = transformer.transform(schema);
  validateModelSchema(parse(out.schema));
  expect(out).toBeDefined();
  expect(out.stacks).toBeDefined();
  expect(out.stacks.PredictionsDirectiveStack).toEqual(undefined);
});

test('lambda function is added to pipeline when lambda dependent action is added', () => {
  const validSchema = `
    type Query {
      speakTranslatedText: String @predictions(actions: [translateText convertTextToSpeech])
    }`;
  const transformer = new GraphQLTransform({
    transformers: [new PredictionsTransformer({ bucketName: 'myStorage${hash}-${env}' })],
  });

  const out = transformer.transform(validSchema);
  expect(out).toBeDefined();
  expect(out.stacks).toBeDefined();
  validateModelSchema(parse(out.schema));
  expect(out.schema).toMatchSnapshot();
  const stack = out.stacks.PredictionsDirectiveStack;
  expect(stack).toBeDefined();
  Template.fromJSON(stack).resourceCountIs('AWS::IAM::Role', 4);
  Template.fromJSON(stack).resourceCountIs('AWS::IAM::Policy', 4);
  Template.fromJSON(stack).resourceCountIs('AWS::AppSync::DataSource', 2);
  Template.fromJSON(stack).resourceCountIs('AWS::AppSync::FunctionConfiguration', 2);
  Template.fromJSON(stack).resourceCountIs('AWS::Lambda::Function', 1);
  Template.fromJSON(stack).resourceCountIs('AWS::AppSync::Resolver', 1);
  expect(out.schema).toContain('speakTranslatedText(input: SpeakTranslatedTextInput!): String');
  Template.fromJSON(stack)
    .hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: {
              Service: 'appsync.amazonaws.com',
            },
          },
        ],
        Version: '2012-10-17',
      },
    });
  Template.fromJSON(stack)
    .hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          {
            Action: 's3:GetObject',
            Effect: 'Allow',
            Resource: Match.anyValue(),
          },
        ],
      },
    });
  Template.fromJSON(stack)
    .hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          {
            Action: 'translate:TranslateText',
            Effect: 'Allow',
            Resource: '*',
          },
        ],
      },
    });
  Template.fromJSON(stack)
    .hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          {
            Action: 'lambda:InvokeFunction',
            Effect: 'Allow',
            Resource: { 'Fn::GetAtt': [Match.anyValue(), 'Arn'] },
          },
        ],
      },
    });
  Template.fromJSON(stack)
    .hasResourceProperties('AWS::AppSync::Resolver', {
      ApiId: { Ref: Match.anyValue() },
      FieldName: 'speakTranslatedText',
      TypeName: 'Query',
      Kind: 'PIPELINE',
      PipelineConfig: {
        Functions: [{ 'Fn::GetAtt': [Match.anyValue(), 'FunctionId'] }, { 'Fn::GetAtt': [Match.anyValue(), 'FunctionId'] }],
      },
      RequestMappingTemplate: {
        'Fn::Join': [
          '\n',
          [
            {
              'Fn::If': [
                'HasEnvironmentParameter',
                {
                  'Fn::Sub': [
                    '$util.qr($ctx.stash.put("s3Bucket", "myStorage${hash}-${env}"))',
                    {
                      hash: {
                        'Fn::Select': [3, { 'Fn::Split': ['-', { Ref: 'AWS::StackName' }] }],
                      },
                      env: { Ref: Match.anyValue() },
                    },
                  ],
                },
                {
                  'Fn::Sub': [
                    '$util.qr($ctx.stash.put("s3Bucket", "myStorage${hash}"))',
                    {
                      hash: {
                        'Fn::Select': [3, { 'Fn::Split': ['-', { Ref: 'AWS::StackName' }] }],
                      },
                    },
                  ],
                },
              ],
            },
            '$util.qr($ctx.stash.put("isList", false))\n{}',
          ],
        ],
      },
      ResponseMappingTemplate:
        '## If the result is a list return the result as a list **\n#if( $ctx.stash.get("isList") )\n  #set( $result = $ctx.result.split("[ ,]+") )\n  $util.toJson($result)\n#else\n  $util.toJson($ctx.result)\n#end',
    });
});

test('return type is a list based on the action', () => {
  const validSchema = `
    type Query {
      translateLabels: String @predictions(actions: [identifyLabels translateText])
    }`;
  const transformer = new GraphQLTransform({
    transformers: [new PredictionsTransformer({ bucketName: 'myStorage${hash}-${env}' })],
  });
  const out = transformer.transform(validSchema);
  expect(out).toBeDefined();
  expect(out.stacks).toBeDefined();
  validateModelSchema(parse(out.schema));
  expect(out.schema).toMatchSnapshot();
  const stack = out.stacks.PredictionsDirectiveStack;
  expect(stack).toBeDefined();
  Template.fromJSON(stack).resourceCountIs('AWS::IAM::Role', 3);
  Template.fromJSON(stack).resourceCountIs('AWS::AppSync::DataSource', 2);
  Template.fromJSON(stack).resourceCountIs('AWS::AppSync::FunctionConfiguration', 2);
  Template.fromJSON(stack).resourceCountIs('AWS::AppSync::Resolver', 1);
  expect(out.schema).toContain('translateLabels(input: TranslateLabelsInput!): [String]');
});

test('can use actions individually and in supported sequences', () => {
  const validSchema = `
    type Query {
      identifyText: String @predictions(actions: identifyText)
      identifyLabels: String @predictions(actions: [identifyLabels])
      convertTextToSpeech: String @predictions(actions: convertTextToSpeech)
      translateText: String @predictions(actions: translateText)
      speakTranslatedIdentifiedText: String @predictions(actions: [identifyText translateText convertTextToSpeech])
      speakTranslatedLabelText: String @predictions(actions: [identifyLabels translateText convertTextToSpeech])
      speakTranslatedText: String @predictions(actions: [translateText convertTextToSpeech])
    }`;
  const transformer = new GraphQLTransform({
    transformers: [new PredictionsTransformer({ bucketName: 'myStorage${hash}-${env}' })],
  });

  const out = transformer.transform(validSchema);
  expect(out).toBeDefined();
  expect(out.stacks).toBeDefined();
  validateModelSchema(parse(out.schema));
  expect(out.schema).toMatchSnapshot();
  const stack = out.stacks.PredictionsDirectiveStack;
  expect(stack).toBeDefined();
  expect(stack).toMatchSnapshot();
});

test('throws if storage is not provided', () => {
  const validSchema = `
    type Query {
      speakTranslatedText: String @predictions(actions: [translateText convertTextToSpeech])
    }`;
  const transformer = new GraphQLTransform({
    transformers: [new PredictionsTransformer()],
  });

  expect(() => {
    transformer.transform(validSchema);
  }).toThrow('Please configure storage in your project in order to use the @predictions directive');
});

test('throws if @predictions is used under a non-Query', () => {
  const schema = `
    type Mutation {
      speakTranslatedText: String @predictions(actions: [translateText convertTextToSpeech])
    }`;
  const transformer = new GraphQLTransform({
    transformers: [new PredictionsTransformer({ bucketName: 'myStorage${hash}-${env}' })],
  });

  expect(() => {
    transformer.transform(schema);
  }).toThrow('@predictions directive only works under Query operations.');
});

test('throws if no actions are provided', () => {
  const schema = `
    type Query {
      speakTranslatedText: String @predictions(actions: [])
    }`;
  const transformer = new GraphQLTransform({
    transformers: [new PredictionsTransformer({ bucketName: 'myStorage${hash}-${env}' })],
  });

  expect(() => {
    transformer.transform(schema);
  }).toThrow('@predictions directive requires at least one action.');
});

test('throws if an unsupported action sequence is provided', () => {
  const schema = `
    type Query {
      speakTranslatedText: String @predictions(actions: [convertTextToSpeech translateText])
    }`;
  const transformer = new GraphQLTransform({
    transformers: [new PredictionsTransformer({ bucketName: 'myStorage${hash}-${env}' })],
  });

  expect(() => {
    transformer.transform(schema);
  }).toThrow('translateText is not supported in this context!');
});

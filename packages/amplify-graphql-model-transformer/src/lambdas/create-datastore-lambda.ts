import {CfnParameter, Construct, Stack} from '@aws-cdk/core';
import {GraphQLAPIProvider, TransformerContextProvider} from '@aws-amplify/graphql-transformer-interfaces';
import {Effect, IRole, Policy, PolicyStatement, Role, ServicePrincipal} from '@aws-cdk/aws-iam';
import { IFunction, Runtime } from '@aws-cdk/aws-lambda';
import { ResourceConstants } from 'graphql-transformer-common';
import path from 'path';

/**
 * Generates a Lambda function for datastore resolution in AppSync within the context of a provided stack
 * @param stack The stack with the lambda function
 * @param apiGraphql GraphQLAPIProvider, used for building lambda correctly in context of Amplify GQL API
 * @param lambdaRole The role to be used by the lambda
 * @return IFunction The lambda function generated for DataStore resolution
 */
export const createDatastoreLambda = (
  stack: Stack,
  apiGraphql: GraphQLAPIProvider,
  lambdaRole: IRole,
): IFunction => {
  const { DataStoreLambdaLogicalID } = ResourceConstants.RESOURCES;

  return apiGraphql.host.addLambdaFunction(
    DataStoreLambdaLogicalID,
    `functions/${DataStoreLambdaLogicalID}.zip`,
    'handler',
    path.resolve(__dirname, '..', '..', 'lib', 'datastore-resolver-lambda.zip'),
    Runtime.NODEJS_14_X,
    [],
    lambdaRole,
    {},
    undefined,
    stack,
  );
};

export const createDatastoreLambdaRole = (context: TransformerContextProvider, stack: Construct): IRole => {
  const { DataStoreLambdaIAMRoleLogicalID } = ResourceConstants.RESOURCES;
  const role = new Role(stack, DataStoreLambdaIAMRoleLogicalID, {
    assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    roleName: context.resourceHelper.generateIAMRoleName('DatastoreLambdaResolverIAMRole'),
  });
  role.attachInlinePolicy(
    new Policy(stack, 'CloudwatchLogsAccess', {
      statements: [
        new PolicyStatement({
          actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
          effect: Effect.ALLOW,
          resources: ['arn:aws:logs:*:*:*'],
        }),
      ],
    }),
  );

  return role;
};

import { describe, expect, test } from 'bun:test'

import {
  localDockerEndpointFromContextInspect,
  splitDomainComposeProjectName,
  splitDomainProcessEnvironment,
} from '../e2e/split-domain-run.mjs'

describe('split-domain invocation isolation', () => {
  test('gives target and rollback distinct invocation-scoped Compose projects', () => {
    const target = splitDomainComposeProjectName('123-mockrun-a1b2c3d4', 'target')
    const rollback = splitDomainComposeProjectName('123-mockrun-a1b2c3d4', 'rollback')

    expect(target).toBe('anomaly-split-123-mockrun-a1b2c3d4-target')
    expect(rollback).toBe('anomaly-split-123-mockrun-a1b2c3d4-rollback')
    expect(target).not.toBe(rollback)
  })

  test('rejects unsafe invocation ids', () => {
    expect(() => splitDomainComposeProjectName('../shared', 'target')).toThrow()
  })

  test('removes database and Docker escape hatches inherited from the caller', () => {
    const isolatedValues = {
      COMPOSE_ENV_FILES: '/tmp/foreign.env',
      COMPOSE_FILE: '/tmp/foreign-compose.yml',
      COMPOSE_PROFILES: 'foreign',
      DATABASE_URL: 'postgresql://production.example/production',
      DOCKER_CERT_PATH: '/tmp/remote-docker-certificates',
      DOCKER_CONTEXT: 'production',
      DOCKER_HOST: 'tcp://production.example:2376',
      DOCKER_TLS_VERIFY: '1',
      E2E_ALLOW_NON_TEST_DATABASE: '1',
      E2E_BACKEND_PORT: '3000',
      E2E_BACKEND_URL: 'https://foreign.example',
      E2E_EDGE_PORT: '3001',
      E2E_EDGE_URL: 'https://foreign-edge.example',
      E2E_KEEP_DOCKER: '1',
      E2E_SKIP_DOCKER: '1',
      E2E_WEB_PORT: '3002',
      E2E_WEB_URL: 'https://foreign-web.example',
      E2E_WEBSITE_PORT: '3003',
      E2E_WEBSITE_URL: 'https://foreign-website.example',
      POSTGRES_TEST_PORT: '5432',
      SPLIT_DOMAIN_BUILD_OUT_DIR: '/tmp/foreign-dist',
      TEST_DATABASE_URL: 'postgresql://production.example/production',
      WEBAPP_RELEASE_BUILD: 'true',
      WEBSITE_RELEASE_BUILD: 'true',
    }
    const environment = splitDomainProcessEnvironment({
      ...isolatedValues,
      KEEP: 'value',
    }, {
      COMPOSE_PROJECT_NAME: 'anomaly-split-mock-target',
      E2E_SPLIT_DOMAIN_MODE: 'target',
    })

    expect(environment).toMatchObject({
      COMPOSE_PROJECT_NAME: 'anomaly-split-mock-target',
      E2E_SPLIT_DOMAIN_MODE: 'target',
      KEEP: 'value',
    })
    for (const name of Object.keys(isolatedValues)) {
      expect(environment[name]).toBeUndefined()
    }
  })

  test('accepts only a local Unix-socket Docker context', () => {
    const localEndpoint = localDockerEndpointFromContextInspect(JSON.stringify([{
      Endpoints: { docker: { Host: 'unix:///Users/test/.docker/run/docker.sock' } },
    }]))
    expect(localEndpoint).toBe('unix:///Users/test/.docker/run/docker.sock')
    expect(splitDomainProcessEnvironment({
      DOCKER_HOST: 'tcp://production.example:2376',
    }, {
      DOCKER_HOST: localEndpoint,
    }).DOCKER_HOST).toBe(localEndpoint)

    for (const host of [
      'tcp://production.example:2376',
      'ssh://operator@production.example',
      'unix://production.example/docker.sock',
    ]) {
      expect(() => localDockerEndpointFromContextInspect(JSON.stringify([{
        Endpoints: { docker: { Host: host } },
      }]))).toThrow('local Unix-socket Docker context')
    }
    expect(() => localDockerEndpointFromContextInspect('not-json')).toThrow(
      'valid Docker context JSON',
    )
  })
})

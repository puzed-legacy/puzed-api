const postgres = require('postgres-fp/promises');

function migrateDatabase (db) {
  return postgres.run(db, `
    CREATE TABLE IF NOT EXISTS "projects" (
      "id" varchar,
      "name" varchar,
      "image" varchar,
      "webPort" int,
      "domain" varchar,
      "secrets" text,
      "environmentVariables" varchar,
      "runCommand" varchar,
      "buildCommand" varchar,
      "owner" varchar,
      "repo" varchar,
      "userId" varchar,
      "dateCreated" varchar
    );

    CREATE TABLE IF NOT EXISTS "deployments" (
      "id" varchar,
      "projectId" varchar,
      "dockerPort" int,
      "dockerHost" varchar,
      "dockerId" varchar,
      "buildLog" text,
      "liveLog" text,
      "status" varchar,
      "dateCreated" varchar
    );

    CREATE TABLE IF NOT EXISTS "githubDeploymentKeys" (
      "id" varchar,
      "githubKeyId" varchar,
      "owner" varchar,
      "repo" varchar,
      "publicKey" varchar,
      "privateKey" varchar,
      "dateCreated" varchar
    );

    CREATE TABLE IF NOT EXISTS "users" (
      "id" varchar,
      "githubUsername" varchar,
      "allowedProjectCreate" bool,
      "dateCreated" varchar
    );
  `);
}

module.exports = migrateDatabase;
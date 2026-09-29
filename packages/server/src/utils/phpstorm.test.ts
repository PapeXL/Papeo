import { describe, expect, it } from "vitest";
import {
  buildRemoteDatabaseBlockCommand,
  parseOpenPhpStormProjects,
  parsePhpStormDeployment,
} from "./phpstorm.js";

function deploymentXml(input: { autoUpload: string; externalChanges: string; local?: string }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="PublishConfigData" autoUpload="${input.autoUpload}" serverName="1.dp.spysystem.dk" remoteFilesAllowedToDisappearOnAutoupload="false" confirmBeforeUploading="false" autoUploadExternalChanges="${input.externalChanges}">
    <serverData>
      <paths name="1.dp.spysystem.dk">
        <serverdata>
          <mappings>
            <mapping deploy="/" local="${input.local ?? "$PROJECT_DIR$"}" web="/" />
          </mappings>
        </serverdata>
      </paths>
    </serverData>
  </component>
</project>`;
}

const WEB_SERVERS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="WebServers">
    <option name="servers">
      <webServer id="other" name="2.dp.spysystem.dk">
        <fileTransfer rootFolder="/var/www/spy/dp/2.dp.spysystem.dk" accessType="SFTP" host="dev.spysystem.dk" port="22" sshConfig="spydev@dev.spysystem.dk:22 key" keyPair="true" />
      </webServer>
      <webServer id="23e2357f" name="1.dp.spysystem.dk">
        <fileTransfer rootFolder="/var/www/spy/dp/1.dp.spysystem.dk" accessType="SFTP" host="dev.spysystem.dk" port="22" sshConfigId="9c60" sshConfig="spydev@dev.spysystem.dk:22 key" keyPair="true" />
      </webServer>
    </option>
  </component>
</project>`;

describe("parsePhpStormDeployment", () => {
  it("reads the upload settings and the remote the project root maps to", () => {
    expect(
      parsePhpStormDeployment({
        deploymentXml: deploymentXml({ autoUpload: "Always", externalChanges: "true" }),
        webServersXml: WEB_SERVERS_XML,
      }),
    ).toEqual({
      autoUploadAlways: true,
      uploadsExternalChanges: true,
      remote: {
        user: "spydev",
        host: "dev.spysystem.dk",
        port: 22,
        rootPath: "/var/www/spy/dp/1.dp.spysystem.dk",
      },
    });
  });

  it("reports upload on explicit save as not automatic", () => {
    const deployment = parsePhpStormDeployment({
      deploymentXml: deploymentXml({
        autoUpload: "On explicit save action",
        externalChanges: "false",
      }),
      webServersXml: WEB_SERVERS_XML,
    });

    expect(deployment.autoUploadAlways).toBe(false);
    expect(deployment.uploadsExternalChanges).toBe(false);
  });

  it("gives no remote when only a subfolder is mapped", () => {
    const deployment = parsePhpStormDeployment({
      deploymentXml: deploymentXml({
        autoUpload: "Always",
        externalChanges: "true",
        local: "$PROJECT_DIR$/public",
      }),
      webServersXml: WEB_SERVERS_XML,
    });

    expect(deployment.remote).toBeNull();
  });

  it("gives no remote without webServers.xml", () => {
    const deployment = parsePhpStormDeployment({
      deploymentXml: deploymentXml({ autoUpload: "Always", externalChanges: "true" }),
      webServersXml: null,
    });

    expect(deployment.remote).toBeNull();
  });
});

describe("parseOpenPhpStormProjects", () => {
  it("lists only the projects marked open, with the home directory expanded", () => {
    const xml = `<application>
  <component name="RecentProjectsManager">
    <option name="additionalInfo">
      <map>
        <entry key="$USER_HOME$/PhpstormProjects/1.dp.spysystem.dk">
          <value>
            <RecentProjectMetaInfo frameTitle="1.dp" opened="true" projectWorkspaceId="a">
            </RecentProjectMetaInfo>
          </value>
        </entry>
        <entry key="$USER_HOME$/PhpstormProjects/old">
          <value>
            <RecentProjectMetaInfo frameTitle="old" projectWorkspaceId="b">
            </RecentProjectMetaInfo>
          </value>
        </entry>
      </map>
    </option>
  </component>
</application>`;

    expect(parseOpenPhpStormProjects(xml, "C:/Users/dev")).toEqual([
      "C:/Users/dev/PhpstormProjects/1.dp.spysystem.dk",
    ]);
  });
});

describe("buildRemoteDatabaseBlockCommand", () => {
  it("prints only the database parameter block, with the path quoted", () => {
    expect(buildRemoteDatabaseBlockCommand("/var/www/it's/config/config.inc.xml")).toBe(
      String.raw`sed -n '/<key>SYSTEM_MYSQL_DATABASE<\/key>/,/<\/parameter>/p' -- '/var/www/it'\''s/config/config.inc.xml'`,
    );
  });
});

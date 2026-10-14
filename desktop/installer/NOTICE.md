NSIS scripts derived from electron-builder 26.15.3 templates (MIT).
Copyright (c) 2015 Loopline Systems. Copyright (c) 2015-present electron-builder contributors.
The upstream LICENSE is included in resources/licenses/build-tool-electron-builder-LICENSE.

installer.nsi retains upstream lifecycle and extraction hooks; wizard.nsh
replaces the assisted pages and retains initMultiUser. Pin and review these
copies when changing electron-builder. Never infer wizard correctness from
configuration alone; run actual installer UI and upgrade tests.

README.md declared MIT before this release, but no standalone LICENSE was
present. The root LICENSE materializes that declaration with a contributor
attribution; it does not claim a newly identified individual copyright owner.
Project ownership/attribution and the installation notice require publisher
review before broad distribution. Third-party notices remain separate.

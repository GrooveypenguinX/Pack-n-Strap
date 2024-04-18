/* eslint-disable @typescript-eslint/naming-convention */

import { ConfigTypes } from "@spt-aki/models/enums/ConfigTypes";
import { DependencyContainer } from "tsyringe";
import { ILostOnDeathConfig } from "@spt-aki/models/spt/config/ILostOnDeathConfig";
import { IPostDBLoadMod } from "@spt-aki/models/external/IPostDBLoadMod";
import { IPreAkiLoadMod } from "@spt-aki/models/external/IPreAkiLoadMod";
import { LogTextColor } from "@spt-aki/models/spt/logging/LogTextColor";
import type { GameController } from "@spt-aki/controllers/GameController";
import type { IEmptyRequestData } from "@spt-aki/models/eft/common/IEmptyRequestData";
import * as config from "../config/config.json";

// WTT imports
import { WTTInstanceManager } from "./WTTInstanceManager";

// Boss imports
import { PackNStrapItemService } from "./PackNStrapItemService";


class PackNStrap
    implements IPreAkiLoadMod, IPostDBLoadMod {
    private Instance: WTTInstanceManager = new WTTInstanceManager();
    private version: string;
    private modName = "WTT-Pack 'n' Strap";

    //#region CustomBosses
    private PackNStrapItemService: PackNStrapItemService = new PackNStrapItemService();

    debug = false;

    public preAkiLoad(container: DependencyContainer): void {
        this.Instance.preAkiLoad(container, this.modName);
        this.Instance.debug = this.debug;
        this.fixStupidMongoIds();
        this.PackNStrapItemService.preAkiLoad(this.Instance);

    }

    public postDBLoad(container: DependencyContainer): void {
        this.Instance.postDBLoad(container);
        this.PackNStrapItemService.postDBLoad();
        this.Instance.logger.log(
            `[${this.modName}] Database: Loading complete.`,
            LogTextColor.GREEN
        );
        if (config.loseArmbandOnDeath) {
            const dblostondeathConfig = this.Instance.configServer.getConfig<ILostOnDeathConfig>(ConfigTypes.LOST_ON_DEATH)
            dblostondeathConfig.equipment.ArmBand = true;
        }
    }

    public fixStupidMongoIds(): void {
        // On game start, see if we need to fix issues from previous versions
        // Note: We do this as a method replacement so we can run _before_ SPT's gameStart
        this.Instance.container.afterResolution("GameController", (_, result: GameController) => {
            const originalGameStart = result.gameStart;

            result.gameStart = (url: string, info: IEmptyRequestData, sessionID: string, startTimeStampMS: number) => {
                // If there's a profile ID passed in, call our fixer method
                if (sessionID) {
                    this.fixProfile(sessionID);
                }

                // Call the original
                originalGameStart.apply(result, [url, info, sessionID, startTimeStampMS]);
            }
        });

    }

    // Handle updating the user profile between versions:
    // - Update the container IDs to the new MongoID format
    // - Look for any key cases in the user's inventory, and properly update the child key locations if we've moved them
    public fixProfile(sessionId: string) {
        const oldSmallCaseIds = [
            "container_smallscavcase",
            "container_toolpouch",
            "container_smalldocscase",
            "container_medpouch",
            "container_ammopouch",
            "container_magpouch",
            "container_lunchbox",
            "container_keyring"
        ];
        const newIdMap = {
            container_smallscavcase: "0c22fc270f59b28c064e1232",
            container_toolpouch: "9543bbe8083934dc3b1b1330",
            container_smalldocscase: "c29f11b2e63a089916739c96",
            container_medpouch: "12403f74773f49be6a2d84b7",
            container_ammopouch: "ae9e418fd5d4c4eec4a0e6ea",
            container_magpouch: "440de5d056825485a0cf3a19",
            container_lunchbox: "6925918065a41e6b1e02a7d7",
            container_keyring: "2eabd4da4ab194eb168e72d3"
        };

        const dbItems = this.Instance.database.templates.items;
        const pmcProfile = this.Instance.profileHelper.getFullProfile(sessionId)?.characters?.pmc;

        // Do nothing if the profile isn't initialized
        if (!pmcProfile?.Inventory?.items) return;

        // Update the container IDs to the new MongoID format
        for (const item of pmcProfile.Inventory.items) {
            if (newIdMap[item._tpl]) {
                item._tpl = newIdMap[item._tpl];
            }
        }

        // Backup the PMC inventory
        const pmcInventory = structuredClone(pmcProfile.Inventory.items);

        // Look for any key cases in the user's inventory, and properly update the child key locations if we've moved them
        for (const oldCaseId of oldSmallCaseIds) {
            if (newIdMap[oldCaseId]) {
                const newCaseId = newIdMap[oldCaseId];

                // Get the template for the case
                const caseTemplate = dbItems[newCaseId];

                // Try to find the case in the user's profile
                const inventoryCases = pmcProfile.Inventory.items.filter(x => x._tpl === oldCaseId);

                for (const inventoryCase of inventoryCases) {
                    const caseChildren = pmcProfile.Inventory.items.filter(x => x.parentId === inventoryCase._id);

                    for (const child of caseChildren) {
                        const newSlot = caseTemplate._props?.Slots?.find(x => x._props?.filters[0]?.Filter[0] === child._tpl);

                        // If we couldn't find a new slot for this key, something has gone horribly wrong, restore the inventory and exit
                        if (!newSlot) {
                            this.Instance.logger.error(`[${this.modName}] : ERROR: Unable to find new slot for ${child._tpl}. Restoring inventory and exiting`);
                            pmcProfile.Inventory.items = pmcInventory;
                            return;
                        }

                        if (newSlot._name !== child.slotId) {
                            this.Instance.logger.debug(`[${this.modName}] : Need to move ${child.slotId} to ${newSlot._name}`);
                            child.slotId = newSlot._name;
                        }
                    }
                }
            }
        }
    }

}

module.exports = { mod: new PackNStrap() };

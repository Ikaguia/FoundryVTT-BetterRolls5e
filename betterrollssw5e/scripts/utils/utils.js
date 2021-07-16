import { isSave } from "../betterrolls5e.js";
import { getSettings } from "../settings.js";
import { SW5E } from "../../../../systems/sw5e/module/config.js";

export const sw5e = SW5E;

/**
 * Shorthand for both game.i18n.format() and game.i18n.localize() depending
 * on whether data is supplied or not
 * @param {string} key
 * @param {object?} data optional data that if given will do a format() instead
 */
export function i18n(key, data=null) {
	if (data) {
		return game.i18n.format(key, data);
	}

	return game.i18n.localize(key);
}

/**
 * Check if the maestro module is enabled and turned on.
 */
function isMaestroOn() {
	let output = false;
	try { if (game.settings.get("maestro", "enableItemTrack")) {
		output = true;
	} }
	catch { return false; }
	return output;
}

export class Utils {
	static getVersion() {
		return game.modules.get("betterrollssw5e").data.version;
	}

	/**
	 * The sound to play for dice rolling. Returns null if an alternative sound
	 * from maestro or dice so nice is registered.
	 * This should be added to the chat message under sound.
	 * @param {boolean} hasMaestroSound optional parameter to denote that maestro is enabled
	 * @returns {string}
	 */
	static getDiceSound(hasMaestroSound=false) {
		const has3DDiceSound = game.dice3d ? game.settings.get("dice-so-nice", "settings").enabled : false;
		const playRollSounds = game.settings.get("betterrollssw5e", "playRollSounds")

		if (playRollSounds && !has3DDiceSound && !hasMaestroSound) {
			return CONFIG.sounds.dice;
		}

		return null;
	}

	static playDiceSound() {
		if (!Utils._playSoundLock) {
			Utils._playSoundLock = true;
			AudioHelper.play({ src: CONFIG.sounds.dice });
			setTimeout(() => Utils._playSoundLock = false, 300);
		}
	}

	/**
	 * Additional data to attach to the chat message.
	 */
	static getWhisperData(rollMode = null) {
		let whisper = undefined;
		let blind = null;

		rollMode = rollMode || game.settings.get("core", "rollMode");
		if ( ["gmroll", "blindroll"].includes(rollMode) ) whisper = ChatMessage.getWhisperRecipients("GM");
		if ( rollMode === "blindroll" ) blind = true;
		else if ( rollMode === "selfroll" ) whisper = [game.user.id];

		return { rollMode, whisper, blind }
	}

	/**
	 * Tests a roll to see if it crit, failed, or was mixed.
	 * @param {Roll} roll
	 * @param {number} threshold optional crit threshold
	 * @param {boolean|number[]} critChecks dice to test, true for all
	 * @param {Roll?} bonus optional bonus roll to add to the total
	 */
	static processRoll(roll, threshold, critChecks=true, bonus=null) {
		if (!roll) return null;

		let high = 0;
		let low = 0;
		for (const d of roll.dice) {
			if (d.faces > 1 && (critChecks == true || critChecks.includes(d.faces))) {
				for (const result of d.results.filter(r => !r.rerolled)) {
					if (result.result >= (threshold || d.faces)) {
						high += 1;
					} else if (result.result == 1) {
						low += 1;
					}
				}
			}
		}

		let critType = null;
		if (high > 0 && low > 0) {
			critType = "mixed";
		} else if (high > 0) {
			critType = "success";
		} else if (low > 0) {
			critType = "failure";
		}

		return {
			roll,
			total: roll.total + (bonus?.total ?? 0),
			ignored: roll.ignored ? true : undefined,
			critType,
			isCrit: high > 0,
		};
	}

	/**
	 * Returns an {adv, disadv} object when given an event.
	 */
	static eventToAdvantage(ev={}) {
		if (ev.shiftKey) {
			return {adv:1, disadv:0};
		} else if (ev.ctrlKey || ev.metaKey) {
			return {adv:0, disadv:1};
		} else {
			return {adv:0, disadv:0};
		}
	}

	/**
	 * Determines rollstate based on several parameters
	 * @param {object} param0
	 * @returns {import("../fields.js").RollState}
	 */
	static getRollState({rollState=null, event=null, adv=null, disadv=null}={}) {
		if (rollState) return rollState;

		if (adv || disadv) {
			adv = adv || 0;
			disadv = disadv || 0;
			if (adv > 0 || disadv > 0) {
				if (adv > disadv) { return "highest"; }
				else if (adv < disadv) { return "lowest"; }
			} else {
				return null;
			}
		}

		if (event) {
			const modifiers = Utils.eventToAdvantage(event);
			if (modifiers.adv || modifiers.disadv) {
				return Utils.getRollState(modifiers);
			}
		}

		return null;
	}

	/**
	 * Returns an item and its actor if given an item, or just the actor otherwise.
	 * @param {Item | Actor} actorOrItem
	 */
	static resolveActorOrItem(actorOrItem) {
		if (!actorOrItem) {
			return {};
		}

		if (actorOrItem instanceof Item) {
			return { item: actorOrItem, actor: actorOrItem?.actor };
		} else {
			return { actor: actorOrItem };
		}
	}

	/**
	 * Returns roll data for an arbitrary item or actor.
	 * Returns the item's roll data first, and then falls back to actor
	 * @returns {object}
	 */
	static getRollData({item = null, actor = null, abilityMod, slotLevel=undefined}) {
		return item ?
			ItemUtils.getRollData(item, { abilityMod, slotLevel }) :
			actor?.getRollData() ?? {};
	}

	/**
	 * Retrieves all tokens currently selected on the canvas. This is the normal select,
	 * not the target select.
	 */
	static getTargetTokens({required=false}={}) {
		const character = game.user.character;
		const controlled = canvas.tokens.controlled;
		if (!controlled.length && character) {
			return [character];
		}

		const results = controlled.filter(a => a);
		if (required && !controlled.length) {
			ui.notifications.warn(game.i18n.localize("SW5e.ActionWarningNoToken"));
		}

		return results;
	}

	/**
	 * Returns all selected actors
	 * @param param1.required True if a warning should be shown if the list is empty
	 */
	static getTargetActors({required=false}={}) {
		return Utils.getTargetTokens({required}).map(character => character.actor).filter(a => a);
	}

	/**
	 * Returns all roll context labels used in roll terms.
	 * Catches things like +1d8[Thunder] active effects
	 * @param  {...any} rolls One or more rolls to extract roll flavors from
	 */
	static getRollFlavors(...rolls) {
		const flavors = new Set();
		for (const roll of rolls) {
			for (const term of (roll?.terms ?? roll?.results ?? [])) {
				if (term.options?.flavor) {
					flavors.add(term.options.flavor);
				}
				if (term.terms || term.results) {
					Utils.getRollFlavors(term).forEach(flavors.add.bind(flavors));
				}
			}
		}

		return Array.from(flavors);
	}

	static findD20Term(d20Roll) {
		if (!d20Roll) return null;

		for (const term of d20Roll.terms ?? d20Roll.rolls ?? []) {
			if (term.faces === 20) return term;
			if (term.terms ?? term.rolls) {
				const innerResult = Utils.findD20Term(term);
				if (innerResult) return innerResult;
			}
		}
	}

	static findD20Result(d20Roll) {
		return Utils.findD20Term(d20Roll)?.total;
	}

	/**
	 * Parses a d20 roll to get the "base" formula, the rollstate,
	 * and the number of times the d20 was rolled.
	 * @param {string | Roll} roll string or Roll object to extract info from
	 * @returns
	 */
	static parseD20Formula(roll) {
		roll = typeof roll === "string" ? new Roll(roll) : roll;

		// Determine if advantage/disadvantage, and how many rolls
		const d20Term = Utils.findD20Term(roll);
		if (!d20Term) {
			return { formula: roll.formula };
		}

		const numRolls = d20Term.number;
		const rollState = d20Term.modifiers.includes("kh")
			? "highest"
			: d20Term.modifiers.includes("kl")
			? "lowest"
			: null;

		// Remove the advantage/disadvantage from the attack roll
		// At least in the current version of foundry, the formula is not cached
		// We need to do this because rolls consolidate to a single total, and we want separate totals
		roll._formula = undefined; // just in case it ever caches using this value in a future release
		d20Term.number = 1;
		d20Term.modifiers = d20Term.modifiers.filter((m) => !["kh", "kl"].includes(m));
		return { formula: roll.formula, numRolls, rollState };
	}
}

export class ActorUtils {
	/**
	 * True if the actor has the halfling luck special trait.
	 * @param {Actor} actor
	 */
	static isHalfling(actor) {
		return getProperty(actor, "data.flags.sw5e.halflingLucky");
	}

	/**
	 * True if the actor has the reliable talent special trait.
	 * @param {Actor} actor
	 */
	static hasReliableTalent(actor) {
		return getProperty(actor, "data.flags.sw5e.reliableTalent");
	}

	/**
	 * True if the actor has the elven accuracy feature
	 * @param {Actor} actor
	 */
	static hasElvenAccuracy(actor) {
		return getProperty(actor, "data.flags.sw5e.elvenAccuracy");
	}

	/**
	 * True if the actor has elven accuracy and the ability
	 * successfully procs it.
	 * @param {Actor} actor
	 * @param {string} ability ability mod shorthand
	 */
	static testElvenAccuracy(actor, ability) {
		return ActorUtils.hasElvenAccuracy(actor) && ["dex", "int", "wis", "cha"].includes(ability);
	}

	/**
	 * Returns the number of additional melee extra critical dice.
	 * @param {*} actor
	 */
	static getMeleeExtraCritDice(actor) {
		return 0;
		// return actor?.getFlag("sw5e", "meleeCriticalDamageDice") ?? 0;
	}

	/**
	 * Returns the crit threshold of an actor. Returns null if no actor is given.
	 * @param {Actor} actor the actor who's data we want
	 * @param {"weapon" | "power" | undefined} itemType the item type we're dealing with
	 */
	static getCritThreshold(actor, itemType) {
		if (!actor) return 20;

		const actorFlags = actor.data.flags.sw5e || {};
		if (itemType === "weapon" && actorFlags.weaponCriticalThreshold) {
			return parseInt(actorFlags.weaponCriticalThreshold);
		} else if (itemType === "power" && actorFlags.powerCriticalThreshold) {
			return parseInt(actorFlags.powerCriticalThreshold);
		} else {
			return 20;
		}
	}

	/**
	 * Returns the image to represent the actor. The result depends on BR settings.
	 * @param {Actor} actor
	 */
	static getImage(actor) {
		if (!actor) return null;

		const actorImage = (actor.data.img && actor.data.img !== CONST.DEFAULT_TOKEN && !actor.data.img.includes("*")) ? actor.data.img : false;
		const tokenImage = actor.token?.data?.img ? actor.token.data.img : actor.data.token.img;

		switch(game.settings.get("betterrollssw5e", "defaultRollArt")) {
			case "actor":
				return actorImage || tokenImage;
			case "token":
				return tokenImage || actorImage;
		}
	}

	/**
	 * Returns a roll object for a skill check
	 * @param {Actor} actor
	 * @param {string} skill
	 * @param {import("../fields.js").RollState} rollState
	 */
	static async getSkillCheckRoll(actor, skill, rollState) {
		return await actor.rollSkill(skill, {
			fastForward: true,
			chatMessage: false,
			advantage: rollState === "highest",
			disadvantage: rollState === "lowest"
		});
	}

	/**
	 * Returns a roll object for an ability check
	 * @param {Actor} actor
	 * @param {string} abl
	 * @param {import("../fields.js").RollState} rollState
	 * @returns {Promise<Roll>}
	 */
	static async getAbilityCheckRoll(actor, abl, rollState) {
		return await actor.rollAbilityTest(abl, {
			fastForward: true,
			chatMessage: false,
			advantage: rollState === "highest",
			disadvantage: rollState === "lowest"
		});
	}

	/**
	 * Returns a roll object for an ability save
	 * @param {Actor} actor
	 * @param {string} abl
	 * @param {import("../fields.js").RollState} rollState
	 * @returns {Promise<Roll>}
	 */
	static async getAbilitySaveRoll(actor, abl, rollState) {
		return await actor.rollAbilitySave(abl, {
			fastForward: true,
			chatMessage: false,
			advantage: rollState === "highest",
			disadvantage: rollState === "lowest"
		});
	}
}

export class ItemUtils {
	static getActivationData(item) {
		const { activation } = item.data.data;
		const activationCost = activation?.cost ?? "";

		if (activation?.type && activation?.type !== "none") {
			return `${activationCost} ${sw5e.abilityActivationTypes[activation.type]}`.trim();
		}

		return null;
	}

	/**
	 * Creates the lower of the item crit threshold, the actor crit threshold, or 20.
	 * Returns null if null is given.
	 * @param {*} item
	 */
	static getCritThreshold(item) {
		if (!item) return null;

		// Get item crit. If its a weapon or power, it might have a DND flag to change the range
		// We take the smallest item crit value
		let itemCrit = Number(getProperty(item, "data.flags.betterRollssw5e.critRange.value")) || 20;
		const characterCrit = ActorUtils.getCritThreshold(item.actor, item.data.type);
		return Math.min(20, characterCrit, itemCrit);
	}

	static getDuration(item) {
		const {duration} = item.data.data;

		if (!duration?.units) {
			return null;
		}

		return `${duration.value ? duration.value : ""} ${sw5e.timePeriods[duration.units]}`.trim()
	}

	static getRange(item) {
		const { range } = item.data.data;

		if (!range?.value && !range?.units) {
			return null;
		}

		const standardRange = range.value || "";
		const longRange = (range.long && range.long !== range.value) ? `/${range.long}` : "";
		const rangeUnit = range.units ? sw5e.distanceUnits[range.units] : "";

		return `${standardRange}${longRange} ${rangeUnit}`.trim();
	}

	static getPowerComponents(item) {
		return null;
	}

	static getTarget(item) {
		const { target } = item.data.data;

		if (!target?.type) {
			return null;
		}

		const targetDistance = target.units && target?.units !== "none" ? ` (${target.value} ${sw5e.distanceUnits[target.units]})` : "";
		return i18n("Target: ") + sw5e.targetTypes[target.type] + targetDistance;
	}

	/**
	 * Ensures that better rolls flag data is set on the item if applicable.
	 * Performs an item update if anything was set and commit is true
	 * @param {Item} itemData item to update
	 * @param {boolean} commit whether to update at the end or not
	 */
	static async ensureFlags(item, { commit=true } = {}) {
		const flags = this.createFlags(item?.data);
		if (!flags) return;
		item.data.flags.betterRollssw5e = flags;

		// Save the updates. Foundry checks for diffs to avoid unnecessary updates
		if (commit) {
			await item.data.update({ "flags.betterRollssw5e": flags }, { diff: true });
		}
	}

	/**
	 * Creates the flags that should be assigned to the the item. Does not save to database.
	 * @param {*} itemData The item.data property to be updated
	 */
	static createFlags(itemData) {
		if (!itemData || CONFIG.betterRollssw5e.validItemTypes.indexOf(itemData.type) == -1) { return; }

		// Initialize flags
		itemData.flags = itemData.flags ?? {};
		const baseFlags = duplicate(CONFIG.betterRollssw5e.allFlags[itemData.type.concat("Flags")]);
		let flags = duplicate(itemData.flags.betterRollssw5e ?? {});
		flags = mergeObject(baseFlags, flags ?? {});

		// If quickDamage flags should exist, update them based on which damage formulae are available
		if (CONFIG.betterRollssw5e.allFlags[itemData.type.concat("Flags")].quickDamage) {
			let newQuickDamageValues = [];
			let newQuickDamageAltValues = [];

			// Make quickDamage flags if they don't exist
			if (!flags.quickDamage) {
				flags.quickDamage = {type: "Array", value: [], altValue: []};
			}

			for (let i = 0; i < itemData.data.damage?.parts.length; i++) {
				newQuickDamageValues[i] = flags.quickDamage.value[i] ?? true;
				newQuickDamageAltValues[i] = flags.quickDamage.altValue[i] ?? true;
			}

			flags.quickDamage.value = newQuickDamageValues;
			flags.quickDamage.altValue = newQuickDamageAltValues;
		}

		return flags;
	}

	static placeTemplate(item) {
		if (item?.hasAreaTarget) {
			const template = game.sw5e.canvas.AbilityTemplate.fromItem(item);
			if (template) template.drawPreview();
			if (item.sheet?.rendered) item.sheet.minimize();
		}
	}

	/**
	 * Finds if an item has a Maestro sound on it, in order to determine whether or not the dice sound should be played.
	 */
	static hasMaestroSound(item) {
		if (!item) return false;
		return (isMaestroOn() && item.data.flags.maestro && item.data.flags.maestro.track) ? true : false;
	}

	/**
	 * Checks if the item applies savage attacks (bonus crit).
	 * Returns false if the actor doesn't have savage attacks, if the item
	 * is not a weapon, or if there is no item.
	 * @param {item?} item
	 */
	static getExtraCritDice(item) {
		if (item?.actor && item?.data.type === "weapon") {
			return ActorUtils.getMeleeExtraCritDice(item.actor);
		}

		return false;
	}

	/**
	 * Gets the item's roll data.
	 * This uses item.getRollData(), but allows overriding with additional properties
	 * @param {*} item
	 */
	static getRollData(item, { abilityMod, slotLevel=undefined } = {}) {
		const rollData = item.getRollData();
		if (rollData) {
			const abl = abilityMod ?? item?.abilityMod;
			rollData.mod = rollData.abilities[abl]?.mod || 0;

			if (slotLevel) {
				rollData.item.level = slotLevel;
			}
		}

		return rollData;
	}

	/**
	 * Returns a roll object that is used to roll the item attack roll.
	 * @param {Item} item
	 * @param {import("../fields.js").RollState} rollState
	 */
	static async getAttackRoll(item, rollState) {
		return await item.rollAttack({
			fastForward: true,
			chatMessage: false,
			advantage: rollState === "highest",
			disadvantage: rollState === "lowest"
		});
	}

	/**
	 * Gets the tool roll (skill check) for a specific item.
	 * @param {Item} item
	 * @param {import("../fields.js").RollState} rollState
	 */
	static async getToolRoll(item, rollState) {
		return await item.rollToolCheck({
			fastForward: true,
			chatMessage: false,
			advantage: rollState === "highest",
			disadvantage: rollState === "lowest"
		});
	}

	/**
	 * Returns the base crit formula, before applying settings to it.
	 * Only useful really to test if a crit is even possible
	 * @param {string} baseFormula
	 * @returns {Roll | null} the base crit formula, or null if there is no dice
	 */
	static getBaseCritRoll(baseFormula) {
		if (!baseFormula) return null;

		const critFormula = baseFormula.replace(/[+-]+\s*(?:@[a-zA-Z0-9.]+|[0-9]+(?![Dd]))/g,"").concat();
		let critRoll = new Roll(critFormula);
		if (critRoll.terms.length === 1 && typeof critRoll.terms[0] === "number") {
			return null;
		}

		return critRoll;
	}

	/**
	 * Derives the formula for what should be rolled when a crit occurs.
	 * Note: Item is not necessary to calculate it.
	 * @param {string} baseFormula
	 * @param {number} baseTotal
	 * @param {number?} param2.critDice extra crit dice
	 * @returns {Roll | null} the crit result, or null if there is no dice
	 */
	static getCritRoll(baseFormula, baseTotal, {settings=null, extraCritDice=null}={}) {
		let critRoll = ItemUtils.getBaseCritRoll(baseFormula);
		if (!critRoll) return null;

		critRoll.alter(1, extraCritDice ?? 0);
		critRoll.roll();

		const { critBehavior } = getSettings(settings);

		// If critBehavior = 2, maximize base dice
		if (critBehavior === "2") {
			critRoll = new Roll(critRoll.formula).evaluate({maximize:true});
		}

		// If critBehavior = 3, maximize base and maximize crit dice
		else if (critBehavior === "3") {
			let maxDifference = Roll.maximize(baseFormula).total - baseTotal;
			let newFormula = critRoll.formula + "+" + maxDifference.toString();
			critRoll = new Roll(newFormula).evaluate({maximize:true});
		}

		// If critBehavior = 4, maximize base dice and roll crit dice
		// Need to get the difference because we're not able to change the base roll from here so we add it to the critical roll
		else if (critBehavior === "4") {
			let maxRoll = new Roll(baseFormula).evaluate({maximize:true});
			let maxDifference = maxRoll.total - baseTotal;
			let newFormula = critRoll.formula + "+" + maxDifference.toString();
			critRoll = new Roll(newFormula).evaluate();
		}

		return critRoll;
	}

	/**
	 * Returns the scaled damage formula of the power
	 * @param {number | "versatile"} damageIndex The index to scale, or versatile
	 * @returns {string | null} the formula if scaled, or null if its not a power
	 */
	static scaleDamage(item, powerLevel, damageIndex, rollData) {
		if (item?.data.type === "power") {
			const versatile = (damageIndex === "versatile");
			if (versatile) {
				damageIndex = 0;
			}

			let itemData = item.data.data;
			let actorData = item.actor.data.data;

			const scale = itemData.scaling.formula;
			let formula = versatile ? itemData.damage.versatile : itemData.damage.parts[damageIndex][0];
			const parts = [formula];

			// Scale damage from up-casting powers
			if (itemData.scaling.mode === "atwill") {
				const level = item.actor.data.type === "character" ?
					actorData.details.level :
					(actorData.details.powerLevel || actorData.details.cr);
				item._scaleAtWillDamage(parts, scale, level, rollData);
			} else if (powerLevel && (itemData.scaling.mode === "level") && itemData.scaling.formula) {
				item._scalePowerDamage(parts, itemData.level, powerLevel, scale, rollData);
			}

			return parts[0];
		}

		return null;
	}


	/**
	 * A function for returning the properties of an item, which can then be printed as the footer of a chat card.
	 */
	static getPropertyList(item) {
		if (!item) return [];

		const data = item.data.data;
		let properties = [];

		const range = ItemUtils.getRange(item);
		const target = ItemUtils.getTarget(item);
		const activation = ItemUtils.getActivationData(item)
		const duration = ItemUtils.getDuration(item);

		switch(item.data.type) {
			case "weapon":
				properties = [
					sw5e.weaponTypes[data.weaponType],
					range,
					target,
					data.proficient ? "" : i18n("Not Proficient"),
					data.weight ? data.weight + " " + i18n("lbs.") : null
				];
				for (const prop in data.properties) {
					if (data.properties[prop] === true) {
						properties.push(sw5e.weaponProperties[prop]);
					}
				}
				break;
			case "consumable":
				properties = [
					data.weight ? data.weight + " " + i18n("lbs.") : null,
					activation,
					duration,
					range,
					target,
				];
				break;
			case "equipment":
				properties = [
					sw5e.equipmentTypes[data.armor.type],
					data.equipped ? i18n("Equipped") : null,
					data.armor.value ? data.armor.value + " " + i18n("AC") : null,
					data.stealth ? i18n("Stealth Disadv.") : null,
					data.weight ? data.weight + " lbs." : null,
				];
				break;
			case "tool":
				properties = [
					sw5e.proficiencyLevels[data.proficient],
					data.ability ? sw5e.abilities[data.ability] : null,
					data.weight ? data.weight + " lbs." : null,
				];
				break;
			case "loot":
				properties = [data.weight ? item.data.totalWeight + " lbs." : null]
				break;
			case "backpack":
				properties = [data.weight ? item.data.totalWeight + " lbs." : null]
				break;

			case "power":
				// Power attack labels
				data.damageLabel = data.actionType === "heal" ? i18n("br5e.chat.healing") : i18n("br5e.chat.damage");
				data.isAttack = data.actionType === "attack";

				properties = [
					sw5e.powerLevels[data.castedLevel ?? data.level],
					sw5e.powerSchools[data.school],
					data.components.ritual ? i18n("Ritual") : null,
					activation,
					duration,
					data.components.concentration ? i18n("Concentration") : null,
					ItemUtils.getPowerComponents(item),
					range,
					target
				];
				break;

			case "class":
				properties = [
					data.levels,
					data.archetype,
				];
				break;
			case "classfeature":
				properties = [
					data.requirements,
					activation,
					duration,
					range,
					target,
				];
				break;
			case "archetype":
				properties = [
					data.className,
					data.classCasterType,
					data.archetype,
				];
				break;

			case "feat":
				properties = [
					data.requirements,
					activation,
					duration,
					range,
					target,
				];
				break;

			case "species":
			case "background":
			case "deployment":
				properties = [
					data.source,
				];
				break;

			case "deploymentfeature":
				properties = [
					data.deployment.value,
					data.requirements,
					data.rank.value,
					activation,
					duration,
					range,
					target,
				];
				break;
			case "venture":
				properties = [
					data.requirements,
					activation,
					duration,
					range,
					target,
				];
				break;

			case "fightingstyle":
				properties = [
					data.requirements,
					activation,
					duration,
					range,
					target,
				];
				break;
			case "fightingmastery":
				properties = [
					data.requirements,
					activation,
					duration,
					range,
					target,
				];
				break;
			case "lightsaberform":
				properties = [
					data.requirements,
					activation,
					duration,
					range,
					target,
				];
				break;

			case "starship":
				properties = [
					data.tier,
					data.hullDice,
					data.pwrDice,
					data.source,
				];
				break;
			case "starshipfeature":
				properties = [
					data.size,
					data.tier,
					activation,
					duration,
					range,
					target,
				];
				break;
			case "starshipmod":
				properties = [
					data.system.value,
					data.grade.value,
					data.baseCost.value,
					data.prerequisites.value,
					activation,
					duration,
					range,
					target,
				];
				break;
		}
		let output = properties.filter(p => (p) && (p.length !== 0) && (p !== " "));
		return output;
	}

	/**
	 * Returns an object with the save DC of the item.
	 * If no save is written in, one is calculated.
	 * @param {Item} item
	 */
	static getSave(item) {
		if (!item || !isSave(item)) {
			return null;
		}

		return {
			ability: item.data.data?.save?.ability,
			dc: item.getSaveDC()
		};
	}
}

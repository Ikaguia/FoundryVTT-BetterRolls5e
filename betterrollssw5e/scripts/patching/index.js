import { getSettings } from "../settings.js";
import { libWrapper } from "./libWrapper.js";

import { d20Roll } from "../../../../systems/sw5e/module/dice.js";
import { sw5e, i18n, Utils } from "../utils/index.js";
import { CustomRoll } from "../custom-roll.js";

export function patchCoreFunctions() {
	if (!libWrapper.is_fallback && !libWrapper.version_at_least?.(1, 4, 0)) {
		Hooks.once("ready", () => {
			const version = "v1.4.0.0";
			ui.notifications.error(i18n("br5e.error.libWrapperMinVersion", { version }));
		});

		return;
	}

	const actorProto = "CONFIG.Actor.documentClass.prototype";
	override("CONFIG.Item.documentClass.prototype.roll", itemRoll);
	override("CONFIG.Item.documentClass.prototype.rollAttack", itemRollAttack);
	override("CONFIG.Item.documentClass.prototype.rollToolCheck", itemRollToolCheck);
	libWrapper.register("betterrollssw5e", `${actorProto}.rollSkill`, actorRollSkill, "MIXED");
	libWrapper.register("betterrollssw5e", `${actorProto}.rollAbilityTest`, actorRollAbilityTest, "MIXED");
	libWrapper.register("betterrollssw5e", `${actorProto}.rollAbilitySave`, actorRollAbilitySave, "MIXED");
}

/**
 * A version of libwrapper OVERRIDE that tries to get the original function.
 * We want Better Rolls and Core 5e to be swappable between each other,
 * and for other modules to wrap over it.
 * @param {*} target
 * @param {*} fn A curried function that takes the original and returns a function to pass to libwrapper
 */
function override(target, fn) {
	libWrapper.register("betterrollssw5e", target, fn, "OVERRIDE", {chain: true});
}

/**
 * Override for Item5e.roll(). This is an OVERRIDE however we still want
 * a passthrough. We need to be lower on priority than Midi.
 * @param {} wrapped
 * @returns
 */
function itemRoll(defaultRoll, options) {
	// Handle options, same defaults as core 5e
	options = mergeObject({
		configureDialog: true,
		createMessage: true,
		event
	}, options, { recursive: false });
	const { rollMode, createMessage, vanilla } = options;
	const altKey = options.event?.altKey;
	const item = this;

	// Case - If the image button should roll a vanilla roll, UNLESS vanilla is defined and is false
	const { imageButtonEnabled, altSecondaryEnabled } = getSettings();
	if (vanilla || (!imageButtonEnabled && vanilla !== false) || (altKey && !altSecondaryEnabled)) {
		return defaultRoll.bind(item)(options);
	}

	const preset = altKey ? 1 : 0;
	const card = window.BetterRolls.rollItem(item, { preset, event: options.event });
	return card.toMessage({ rollMode, createMessage });
}

/**
 * Override for Item5e.rollAttack(). Only kicks in if options.chatMessage is off.
 * It is basically an exact copy of the built in rollAttack, except that it doesn't consume ammo.
 * Unfortunately D&D does not allow a rollAttack() to not consume ammo.
 * @param {} wrapped
 * @returns
 */
async function itemRollAttack(defaultRoll, options) {
	// Call the default version if chatMessage is enabled
	if (options?.chatMessage !== false) {
		return defaultRoll.bind(this)(options);
	}

	const flags = this.actor.data.flags.sw5e || {};
	if ( !this.hasAttack ) {
	  throw new Error("You may not place an Attack Roll with this Item.");
	}

	let title = `${this.name} - ${game.i18n.localize("SW5E.AttackRoll")}`;

	// get the parts and rollData for this item's attack
	const {parts, rollData} = this.getAttackToHit();

	// Compose roll options
	const rollConfig = mergeObject({
		parts: parts,
		actor: this.actor,
		data: rollData,
		title: title,
		flavor: title,
		dialogOptions: {
			width: 400,
			top: options.event ? options.event.clientY - 80 : null,
			left: window.innerWidth - 710
		},
		messageData: {
			speaker: ChatMessage.getSpeaker({actor: this.actor}),
			"flags.sw5e.roll": { type: "attack", itemId: this.id }
		}
	}, options);
	rollConfig.event = options.event;

	// Expanded critical hit thresholds
	if (( this.data.type === "weapon" ) && flags.weaponCriticalThreshold) {
	  rollConfig.critical = parseInt(flags.weaponCriticalThreshold);
	} else if (( this.data.type === "power" ) && flags.powerCriticalThreshold) {
	  rollConfig.critical = parseInt(flags.powerCriticalThreshold);
	}

	// Elven Accuracy
	if ( ["weapon", "power"].includes(this.data.type) ) {
	  if (flags.elvenAccuracy && ["dex", "int", "wis", "cha"].includes(this.abilityMod)) {
		rollConfig.elvenAccuracy = true;
	  }
	}

	// Apply Halfling Lucky
	if ( flags.halflingLucky ) rollConfig.halflingLucky = true;

	// Invoke the d20 roll helper
	const roll = await d20Roll(rollConfig);
	if ( roll === false ) return null;
	return roll;
}

async function itemRollToolCheck(original, options) {
	if (options?.chatMessage === false || options?.vanilla) {
		return original.call(this, options);
	}

	const evt = options?.event ?? event;
	const preset = evt?.altKey ? 1 : 0;
	const card = window.BetterRolls.rollItem(this, { preset, ...options });
	return card.toMessage();
}

async function actorRollSkill(original, skillId, options) {
	if (options?.chatMessage === false || options?.vanilla) {
		return original.call(this, skillId, options);
	}

	const roll = await original.call(this, skillId, {
		...options,
		fastForward: true,
		chatMessage: false,
		...Utils.getRollState(options),
	});

	return CustomRoll._fullRollActor(this, i18n(sw5e.skills[skillId]), roll);
}

async function actorRollAbilityTest(original, ability, options) {
	if (options?.chatMessage === false || options?.vanilla) {
		return original.call(this, ability, options);
	}

	const roll = await original.call(this, ability, {
		...options,
		fastForward: true,
		chatMessage: false,
		...Utils.getRollState(options),
	});

	const label = `${i18n(sw5e.abilities[ability])} ${i18n("br5e.chat.check")}`;
	return CustomRoll._fullRollActor(this, label, roll);
}

async function actorRollAbilitySave(original, ability, options) {
	if (options?.chatMessage === false || options?.vanilla) {
		return original.call(this, ability, options);
	}

	const roll = await original.call(this, ability, {
		...options,
		fastForward: true,
		chatMessage: false,
		...Utils.getRollState(options),
	});

	const label = `${i18n(sw5e.abilities[ability])} ${i18n("br5e.chat.save")}`;
	return CustomRoll._fullRollActor(this, label, roll);
}

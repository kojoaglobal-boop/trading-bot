export function getPaperTrainingProfile(config, profileName = "standard") {
  const training = config.paperTraining || {};
  const profiles = training.profiles || {};
  const name = normalizeProfileName(profileName || training.defaultProfile || "standard");

  if (name === "standard") {
    return {
      name,
      config: profiles.standard || {}
    };
  }

  if (!profiles[name]) {
    const available = ["standard", ...Object.keys(profiles).filter((profile) => profile !== "standard")]
      .filter((profile, index, list) => list.indexOf(profile) === index)
      .join(", ");
    throw new Error(`Unknown paper training profile "${name}". Available profiles: ${available}`);
  }

  return {
    name,
    config: profiles[name]
  };
}

function normalizeProfileName(profileName) {
  return String(profileName || "standard").trim().toLowerCase();
}

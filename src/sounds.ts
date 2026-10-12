export const SYNTHS = ['triangle', 'sawtooth', 'square', 'sine', 'supersaw', 'pulse'];

export const SOUNDFONTS = [
  'gm_piano', 'gm_epiano1', 'gm_epiano2', 'gm_bright_acoustic_piano', 'gm_electric_grand_piano', 'gm_harpsichord',
  'gm_clavinet', 'gm_celesta', 'gm_glockenspiel', 'gm_music_box', 'gm_vibraphone', 'gm_marimba', 'gm_xylophone',
  'gm_tubular_bells', 'gm_drawbar_organ', 'gm_percussive_organ', 'gm_rock_organ', 'gm_church_organ', 'gm_accordion',
  'gm_acoustic_guitar_nylon', 'gm_acoustic_guitar_steel', 'gm_electric_guitar_jazz', 'gm_electric_guitar_clean',
  'gm_electric_guitar_muted', 'gm_overdriven_guitar', 'gm_distortion_guitar', 'gm_acoustic_bass',
  'gm_electric_bass_finger', 'gm_electric_bass_pick', 'gm_fretless_bass', 'gm_slap_bass_1', 'gm_synth_bass_1',
  'gm_synth_bass_2', 'gm_violin', 'gm_viola', 'gm_cello', 'gm_contrabass', 'gm_tremolo_strings',
  'gm_pizzicato_strings', 'gm_orchestral_harp', 'gm_timpani', 'gm_string_ensemble_1', 'gm_string_ensemble_2',
  'gm_synth_strings_1', 'gm_choir_aahs', 'gm_voice_oohs', 'gm_synth_choir', 'gm_orchestra_hit', 'gm_trumpet',
  'gm_trombone', 'gm_tuba', 'gm_french_horn', 'gm_brass_section', 'gm_synth_brass_1', 'gm_soprano_sax',
  'gm_alto_sax', 'gm_tenor_sax', 'gm_oboe', 'gm_english_horn', 'gm_bassoon', 'gm_clarinet', 'gm_piccolo',
  'gm_flute', 'gm_recorder', 'gm_pan_flute', 'gm_ocarina', 'gm_lead_1_square', 'gm_lead_2_sawtooth',
  'gm_lead_5_charang', 'gm_lead_8_bass_lead', 'gm_pad_warm', 'gm_pad_poly', 'gm_pad_choir', 'gm_pad_halo',
  'gm_pad_sweep', 'gm_fx_crystal', 'gm_fx_atmosphere', 'gm_sitar', 'gm_banjo', 'gm_koto', 'gm_kalimba',
  'gm_steel_drums', 'gm_synth_drum', 'gm_taiko_drum', 'gm_melodic_tom',
];

export const soundLabel = (s: string) => s.replace(/^gm_/, '').replace(/_/g, ' ');

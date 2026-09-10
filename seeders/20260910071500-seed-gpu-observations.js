/**
 * Seeds the six observations and 78 keyframes the GPU pipeline produced on 2026-09-09
 * (job 132, session 142, model CAMPA_GR1_TEST6-mixed) over `20240730_171520_Fwd.mp4`,
 * frames 18000-18299.
 *
 * **Why this exists.** These are the only real machine-written observations MARP has, and
 * producing them took a live Jellyfin, a GPU and an inference run. That is not something a
 * test, a fresh clone or another machine can repeat on demand, so the output is checked in
 * here instead. The umbrella states the rule: *"'Seed it' means write a seeder, not type
 * SQL. Anything another machine or another person will need again goes in the repository as
 * a migration or a checked-in script that can be run twice."*
 *
 * **A seeder, and deliberately not a migration.** Migrations run against production when
 * `master` is promoted, and that database is a scientific record. Fabricated observations
 * must never be able to reach it. Seeders run only when somebody asks for them, which is
 * the whole difference and the reason this file lives here.
 *
 * **Depends on the pipeline context** -- project 43, session 142 and `ml_models` 91 -- the
 * same way this directory's observations seed depends on its sessions seed. Run
 * `node scripts/seed-inference-context.js --apply` first. This refuses with that
 * instruction rather than failing on a foreign key.
 *
 * **`gpu_job_id` is deliberately null.** The real rows carry job 132, but a `gpu_jobs` row
 * records an execution on a particular machine, and inventing one here would claim a job
 * ran on a database where it never did. The column is nullable and its foreign key is
 * `SET NULL`. `ml_model_id` is kept, because *which model produced this observation* is a
 * fact about the data rather than about the run.
 *
 * @fileoverview Seed data for the first real GPU-written observations.
 * @author Isaac Travers
 * @module seeders/seed-gpu-observations
 */

'use strict';

/** Observations, exactly as the ingest wrote them. @constant @type {Array<Object>} */
const OBSERVATIONS = [
    { observation_id: 1, project_id: 43, session_id: 142, tc: "00:12:03", frame: "9", taxserial: 158344, comname: "California sea cucumber", count: 1, video_source: "20240730_171520_Fwd.mp4", mediaPosition: "00:12:03.3600000", actualPosition: "00:12:03.3600000", obsID: 1, "PobsID": 1, confidence: 0.7502287030220032, species_id: 775, version: 1, ml_model_id: 91, jellyfin_item_id: "4ac4749aae0a8d75ac99f2d8d50717ce" },
    { observation_id: 2, project_id: 43, session_id: 142, tc: "00:12:01", frame: "12", taxserial: 158344, comname: "California sea cucumber", count: 1, video_source: "20240730_171520_Fwd.mp4", mediaPosition: "00:12:01.4800000", actualPosition: "00:12:01.4800000", obsID: 2, "PobsID": 2, confidence: 0.6932578086853027, species_id: 775, version: 1, ml_model_id: 91, jellyfin_item_id: "4ac4749aae0a8d75ac99f2d8d50717ce" },
    { observation_id: 3, project_id: 43, session_id: 142, tc: "00:12:02", frame: "20", taxserial: 158344, comname: "California sea cucumber", count: 1, video_source: "20240730_171520_Fwd.mp4", mediaPosition: "00:12:02.8000000", actualPosition: "00:12:02.8000000", obsID: 3, "PobsID": 3, confidence: 0.6299106478691101, species_id: 775, version: 1, ml_model_id: 91, jellyfin_item_id: "4ac4749aae0a8d75ac99f2d8d50717ce" },
    { observation_id: 4, project_id: 43, session_id: 142, tc: "00:12:07", frame: "15", taxserial: 158344, comname: "California sea cucumber", count: 1, video_source: "20240730_171520_Fwd.mp4", mediaPosition: "00:12:07.6000000", actualPosition: "00:12:07.6000000", obsID: 4, "PobsID": 4, confidence: 0.6722943186759949, species_id: 775, version: 1, ml_model_id: 91, jellyfin_item_id: "4ac4749aae0a8d75ac99f2d8d50717ce" },
    { observation_id: 5, project_id: 43, session_id: 142, tc: "00:12:10", frame: "1", taxserial: 158344, comname: "California sea cucumber", count: 1, video_source: "20240730_171520_Fwd.mp4", mediaPosition: "00:12:10.0400000", actualPosition: "00:12:10.0400000", obsID: 5, "PobsID": 5, confidence: 0.7423014640808105, species_id: 775, version: 1, ml_model_id: 91, jellyfin_item_id: "4ac4749aae0a8d75ac99f2d8d50717ce" },
    { observation_id: 6, project_id: 43, session_id: 142, tc: "00:12:11", frame: "3", taxserial: 158344, comname: "California sea cucumber", count: 1, video_source: "20240730_171520_Fwd.mp4", mediaPosition: "00:12:11.1200000", actualPosition: "00:12:11.1200000", obsID: 6, "PobsID": 6, confidence: 0.7243432998657227, species_id: 775, version: 1, ml_model_id: 91, jellyfin_item_id: "4ac4749aae0a8d75ac99f2d8d50717ce" },
];

/** Keyframes, ordered by observation then frame. @constant @type {Array<Object>} */
const KEYFRAMES = [
    { keyframe_id: 724, observation_id: 1, subset: "1", comname: "California sea cucumber", type: "start", framenum: 18000, x: 0.7584090799198732, y: 0.327186735136073, width: 0.08854718409104839, height: 0.06585938245385893, confidence: null },
    { keyframe_id: 725, observation_id: 1, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18013, x: 0.7699208633263308, y: 0.3522998292225811, width: 0.09259886196669594, height: 0.06773438664625119, confidence: null },
    { keyframe_id: 726, observation_id: 1, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18028, x: 0.7960389260803724, y: 0.3929457253632758, width: 0.09903521446134478, height: 0.07108810384904046, confidence: null },
    { keyframe_id: 727, observation_id: 1, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18049, x: 0.8106879633572319, y: 0.4500455168368715, width: 0.10368938196224821, height: 0.07231627864875104, confidence: null },
    { keyframe_id: 728, observation_id: 1, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18096, x: 0.8362135080034062, y: 0.5878240815908311, width: 0.13723422992614273, height: 0.09293883227085331, confidence: null },
    { keyframe_id: 729, observation_id: 1, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18101, x: 0.8421350603201082, y: 0.5964406036803439, width: 0.14128711017190865, height: 0.09539340344345484, confidence: null },
    { keyframe_id: 730, observation_id: 1, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18119, x: 0.8724519611699959, y: 0.6066832205460702, width: 0.15940664314137573, height: 0.10650129566846568, confidence: null },
    { keyframe_id: 731, observation_id: 1, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18131, x: 0.8981088611469861, y: 0.6262123810654882, width: 0.16917084887130907, height: 0.11372996368685433, confidence: null },
    { keyframe_id: 732, observation_id: 1, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18133, x: 0.9034182409442643, y: 0.634933210554883, width: 0.18031097666649393, height: 0.12202683627450096, confidence: null },
    { keyframe_id: 733, observation_id: 1, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18136, x: 0.9092594653294455, y: 0.6436179873987493, width: 0.173681438672419, height: 0.11712926257079875, confidence: null },
    { keyframe_id: 734, observation_id: 1, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18138, x: 0.9134198553158918, y: 0.6511775810831995, width: 0.18025416597676294, height: 0.12199914194138702, confidence: null },
    { keyframe_id: 735, observation_id: 1, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18142, x: 0.9177182569405328, y: 0.6605334311298348, width: 0.1589228349965952, height: 0.10618449070087006, confidence: null },
    { keyframe_id: 736, observation_id: 1, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18148, x: 0.9255852470998798, y: 0.6859608259177197, width: 0.15093616849165736, height: 0.09986160240984336, confidence: null },
    { keyframe_id: 737, observation_id: 1, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18155, x: 0.9359851296424574, y: 0.7245621022126086, width: 0.148363263438349, height: 0.10390945734403906, confidence: null },
    { keyframe_id: 738, observation_id: 1, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18157, x: 0.9394642959535608, y: 0.7342174534164502, width: 0.15464104433456313, height: 0.11324448084033216, confidence: null },
    { keyframe_id: 739, observation_id: 1, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18163, x: 0.9507394296715196, y: 0.7818402966874952, width: 0.12502059885786757, height: 0.10326887851547524, confidence: null },
    { keyframe_id: 740, observation_id: 1, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18165, x: 0.9544443560345933, y: 0.7983119494438434, width: 0.12486784951130686, height: 0.10833278468836595, confidence: null },
    { keyframe_id: 741, observation_id: 1, subset: "1", comname: "California sea cucumber", type: "end", framenum: 18167, x: 0.9582880537375731, y: 0.8137078853260299, width: 0.11407420174802098, height: 0.10420756208314154, confidence: null },
    { keyframe_id: 742, observation_id: 2, subset: "1", comname: "California sea cucumber", type: "start", framenum: 18011, x: 0.836070458829792, y: 0.6468421646059067, width: 0.07402984849756497, height: 0.07783860800232299, confidence: null },
    { keyframe_id: 743, observation_id: 2, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18015, x: 0.8439040437742068, y: 0.6617499061478487, width: 0.08495232983061766, height: 0.09139369497771525, confidence: null },
    { keyframe_id: 744, observation_id: 2, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18018, x: 0.8511577842282996, y: 0.6797192610026, width: 0.079417949831775, height: 0.08613070022642869, confidence: null },
    { keyframe_id: 745, observation_id: 2, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18027, x: 0.8697161224276031, y: 0.7237030849290684, width: 0.08445082299305336, height: 0.09553090329257287, confidence: null },
    { keyframe_id: 746, observation_id: 2, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18034, x: 0.8832168375747153, y: 0.7663329548175444, width: 0.08554198937937996, height: 0.09868363681045907, confidence: null },
    { keyframe_id: 747, observation_id: 2, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18042, x: 0.8971863074748613, y: 0.8089525715756338, width: 0.09934788606308614, height: 0.12025278949905328, confidence: null },
    { keyframe_id: 748, observation_id: 2, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18058, x: 0.9170764168025106, y: 0.8946095311115522, width: 0.10097886454667014, height: 0.13008628557595317, confidence: null },
    { keyframe_id: 749, observation_id: 2, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18063, x: 0.9349552489994278, y: 0.933760955114032, width: 0.11162428717913388, height: 0.14199275323590188, confidence: null },
    { keyframe_id: 750, observation_id: 2, subset: "1", comname: "California sea cucumber", type: "end", framenum: 18064, x: 0.930834630490341, y: 0.9376097333824844, width: 0.10854431507341718, height: 0.13838468131880663, confidence: null },
    { keyframe_id: 751, observation_id: 3, subset: "1", comname: "California sea cucumber", type: "start", framenum: 18033, x: 0.26746636991842665, y: 0.5745179079394155, width: 0.07558672244667862, height: 0.06852275887651633, confidence: null },
    { keyframe_id: 752, observation_id: 3, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18044, x: 0.2490553427274187, y: 0.6200850645402134, width: 0.07973283845965855, height: 0.06979425774371953, confidence: null },
    { keyframe_id: 753, observation_id: 3, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18065, x: 0.19807955622029205, y: 0.7086473595071038, width: 0.09063851631009778, height: 0.07639097020786222, confidence: null },
    { keyframe_id: 754, observation_id: 3, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18077, x: 0.1584732477071768, y: 0.7661178857184313, width: 0.09373423957552608, height: 0.07438551767910818, confidence: null },
    { keyframe_id: 755, observation_id: 3, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18080, x: 0.15053777088975936, y: 0.7797494016845045, width: 0.10203201258013082, height: 0.07978806841865493, confidence: null },
    { keyframe_id: 756, observation_id: 3, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18088, x: 0.11816666343981189, y: 0.8199305522066013, width: 0.10151925586088371, height: 0.07746269053747189, confidence: null },
    { keyframe_id: 757, observation_id: 3, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18095, x: 0.09117842439326129, y: 0.8559588395977703, width: 0.11332642278957057, height: 0.08470369154540736, confidence: null },
    { keyframe_id: 758, observation_id: 3, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18097, x: 0.08369722622613722, y: 0.8637411859140341, width: 0.10893065824216247, height: 0.0800622804573335, confidence: null },
    { keyframe_id: 759, observation_id: 3, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18105, x: 0.049827247493727175, y: 0.8966155594447963, width: 0.12072583432677107, height: 0.08905266924041005, confidence: null },
    { keyframe_id: 760, observation_id: 3, subset: "1", comname: "California sea cucumber", type: "end", framenum: 18107, x: 0.045919625953176134, y: 0.900619290143601, width: 0.11197738075116333, height: 0.08489508198002325, confidence: null },
    { keyframe_id: 761, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "start", framenum: 18151, x: 0.7827614405642338, y: 0.49475166603209275, width: 0.10187299213401162, height: 0.07587692825559186, confidence: null },
    { keyframe_id: 762, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18155, x: 0.775565052397643, y: 0.5108784910608488, width: 0.11018331350105752, height: 0.08168263235893011, confidence: null },
    { keyframe_id: 763, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18157, x: 0.7808134059404098, y: 0.5170979840633243, width: 0.10956594591865276, height: 0.08051160505763637, confidence: null },
    { keyframe_id: 764, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18160, x: 0.779675128847739, y: 0.5303089530973796, width: 0.12381646844782894, height: 0.08716698924882893, confidence: null },
    { keyframe_id: 765, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18163, x: 0.7899916312193892, y: 0.5409120084494295, width: 0.12217788454112226, height: 0.08538360587084423, confidence: null },
    { keyframe_id: 766, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18166, x: 0.7798391462588231, y: 0.5568916592852673, width: 0.14175382623893618, height: 0.09321812771728306, confidence: null },
    { keyframe_id: 767, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18171, x: 0.7993702715743226, y: 0.5718305279346794, width: 0.15230601625486342, height: 0.09452797717451414, confidence: null },
    { keyframe_id: 768, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18172, x: 0.7958129380217027, y: 0.5757872534101122, width: 0.15814378230185236, height: 0.09640866617484865, confidence: null },
    { keyframe_id: 769, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18175, x: 0.8116552865745328, y: 0.5862448810087856, width: 0.15244151017447055, height: 0.09278594153596932, confidence: null },
    { keyframe_id: 770, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18180, x: 0.8201609413378181, y: 0.603105802980557, width: 0.15960236597319288, height: 0.09789745269219775, confidence: null },
    { keyframe_id: 771, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18183, x: 0.8153143679718377, y: 0.6120173522370623, width: 0.1725660784806151, height: 0.10120772283285857, confidence: null },
    { keyframe_id: 772, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18187, x: 0.8355198246087618, y: 0.6251762847571307, width: 0.1798452865960677, height: 0.10531656614754165, confidence: null },
    { keyframe_id: 773, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18192, x: 0.8408003873630784, y: 0.6465992473746071, width: 0.17996815047619, height: 0.10692532918396616, confidence: null },
    { keyframe_id: 774, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18199, x: 0.8455235661238194, y: 0.6835845309590328, width: 0.2144858196552629, height: 0.12250986383283385, confidence: null },
    { keyframe_id: 775, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18206, x: 0.8653771602303222, y: 0.728608766382837, width: 0.23851996431806813, height: 0.13520318030300796, confidence: null },
    { keyframe_id: 776, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18208, x: 0.8714458937390916, y: 0.7476310418719826, width: 0.25976697448508634, height: 0.14930711729160198, confidence: null },
    { keyframe_id: 777, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18210, x: 0.8883234258333801, y: 0.7633865067168932, width: 0.25089237768275974, height: 0.14729961789721013, confidence: null },
    { keyframe_id: 778, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18212, x: 0.8884971455075965, y: 0.7774515076430658, width: 0.24298975145057905, height: 0.14686838794421153, confidence: null },
    { keyframe_id: 779, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18213, x: 0.8979905503971304, y: 0.7861333067464166, width: 0.241714277647361, height: 0.14883264408207433, confidence: null },
    { keyframe_id: 780, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18214, x: 0.8948853086739939, y: 0.7938045763199038, width: 0.23921964699369325, height: 0.1491216755431426, confidence: null },
    { keyframe_id: 781, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18215, x: 0.9007937372508561, y: 0.8093177024652699, width: 0.25342477901779203, height: 0.1609001360110283, confidence: null },
    { keyframe_id: 782, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18216, x: 0.9024251490183067, y: 0.8156063624067484, width: 0.23655357633709834, height: 0.15389775833346955, confidence: null },
    { keyframe_id: 783, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18218, x: 0.905455869424654, y: 0.8311660275048837, width: 0.22879674016876192, height: 0.15366600973517164, confidence: null },
    { keyframe_id: 784, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18220, x: 0.9066971130066322, y: 0.8508292651158277, width: 0.2283877353866013, height: 0.16096135389982202, confidence: null },
    { keyframe_id: 785, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18225, x: 0.9120192752796168, y: 0.9161177120904588, width: 0.22898441827978935, height: 0.1787589978199265, confidence: null },
    { keyframe_id: 786, observation_id: 4, subset: "1", comname: "California sea cucumber", type: "end", framenum: 18228, x: 0.9149086429910306, y: 0.9392953712650244, width: 0.18351086034813013, height: 0.14517158556088583, confidence: null },
    { keyframe_id: 787, observation_id: 5, subset: "1", comname: "California sea cucumber", type: "start", framenum: 18155, x: 0.43758323351652123, y: 0.3796412544030832, width: 0.06290063354664471, height: 0.06631765827448242, confidence: null },
    { keyframe_id: 788, observation_id: 5, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18171, x: 0.4239232056484807, y: 0.42559513375607033, width: 0.06836502247502767, height: 0.06846663128740094, confidence: null },
    { keyframe_id: 789, observation_id: 5, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18197, x: 0.3919591868744376, y: 0.46550691937583694, width: 0.08293241787798185, height: 0.07581959114090726, confidence: null },
    { keyframe_id: 790, observation_id: 5, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18207, x: 0.3739435679986331, y: 0.48789487653708785, width: 0.08995519157029681, height: 0.08129827190842513, confidence: null },
    { keyframe_id: 791, observation_id: 5, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18219, x: 0.3507320800468549, y: 0.5290802635564154, width: 0.09389932353122703, height: 0.08364807338474865, confidence: null },
    { keyframe_id: 792, observation_id: 5, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18231, x: 0.3296382617585357, y: 0.5876585728080633, width: 0.09972342554126573, height: 0.08902698171763246, confidence: null },
    { keyframe_id: 793, observation_id: 5, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18246, x: 0.34295840414785217, y: 0.6564046788904325, width: 0.11264052090325014, height: 0.10070336756589161, confidence: null },
    { keyframe_id: 794, observation_id: 5, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18254, x: 0.3405909574874045, y: 0.7022450131155756, width: 0.11986818098002465, height: 0.10710897895681212, confidence: null },
    { keyframe_id: 795, observation_id: 5, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18268, x: 0.3119752730446037, y: 0.8032378076089988, width: 0.1343451377528489, height: 0.11781842593211823, confidence: null },
    { keyframe_id: 796, observation_id: 5, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18284, x: 0.25336938845378526, y: 0.9394381058799901, width: 0.1534994849481707, height: 0.1324361072372537, confidence: null },
    { keyframe_id: 797, observation_id: 5, subset: "1", comname: "California sea cucumber", type: "end", framenum: 18286, x: 0.24534992385839452, y: 0.9491918060631765, width: 0.14126701395343647, height: 0.117937249186869, confidence: null },
    { keyframe_id: 798, observation_id: 6, subset: "1", comname: "California sea cucumber", type: "start", framenum: 18257, x: 0.6106252081778025, y: 0.3062996711244554, width: 0.04527960179954215, height: 0.08237686910437952, confidence: null },
    { keyframe_id: 799, observation_id: 6, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18266, x: 0.6162497768687341, y: 0.3237158651448681, width: 0.04573862907047868, height: 0.0856821305176101, confidence: null },
    { keyframe_id: 800, observation_id: 6, subset: "1", comname: "California sea cucumber", type: "middle", framenum: 18282, x: 0.6124194982230831, y: 0.35866930835597177, width: 0.048776610264105215, height: 0.10108772798419532, confidence: null },
    { keyframe_id: 801, observation_id: 6, subset: "1", comname: "California sea cucumber", type: "end", framenum: 18299, x: 0.6023295017998249, y: 0.40919139662091497, width: 0.04887767119469233, height: 0.10261240094777588, confidence: null },
];

/** @type {Object} */
module.exports = {
  /**
   * Inserts the observations and their keyframes, in that order.
   *
   * Idempotent: it removes its own rows first, so a second run leaves one copy rather
   * than failing on a primary key.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface.
   * @param {Object} Sequelize - Sequelize library.
   * @returns {Promise<void>} Resolves once committed.
   * @throws {Error} When the pipeline context is missing, naming the fix.
   */
  async up(queryInterface, Sequelize) {
    const [context] = await queryInterface.sequelize.query(
      `SELECT (SELECT count(*) FROM projects WHERE project_id = 43) AS project,
              (SELECT count(*) FROM sessions WHERE session_id = 142) AS session,
              (SELECT count(*) FROM ml_models WHERE id = 91) AS model`,
      { type: Sequelize.QueryTypes.SELECT }
    );

    const missing = Object.entries(context)
      .filter(([, count]) => Number(count) === 0)
      .map(([name]) => name);

    if (missing.length) {
      throw new Error(
        `Cannot seed the GPU observations: missing ${missing.join(', ')}. `
        + 'Run `node scripts/seed-inference-context.js --apply` first -- it creates '
        + 'project 43, session 142 and ml_models 91, which these rows reference.'
      );
    }

    const transaction = await queryInterface.sequelize.transaction();

    try {
      const now = new Date();

      // Remove first, so a second run is a no-op rather than a key violation.
      // Keyframes go with them by cascade.
      await queryInterface.bulkDelete(
        'observations',
        { observation_id: OBSERVATIONS.map((r) => r.observation_id) },
        { transaction }
      );

      await queryInterface.bulkInsert(
        'observations',
        OBSERVATIONS.map((r) => ({ ...r, createdAt: now, updatedAt: now })),
        { transaction }
      );

      await queryInterface.bulkInsert(
        'keyframes',
        KEYFRAMES.map((r) => ({ ...r, createdAt: now, updatedAt: now })),
        { transaction }
      );

      // Re-link the job, but only on a database that actually has it. The rows
      // ship with `gpu_job_id` null because a `gpu_jobs` row records an execution
      // on one machine; where that execution really happened -- the machine the
      // pipeline was run on -- the link is a true fact and worth keeping rather
      // than discarding just because the seeder had to be portable.
      await queryInterface.sequelize.query(
        `UPDATE observations SET gpu_job_id = 132
          WHERE observation_id IN (:ids)
            AND EXISTS (SELECT 1 FROM gpu_jobs WHERE id = 132)`,
        { replacements: { ids: OBSERVATIONS.map((r) => r.observation_id) }, transaction }
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  /**
   * Removes the observations. The keyframes go with them by cascade.
   *
   * @async
   * @param {Object} queryInterface - Sequelize QueryInterface.
   * @param {Object} Sequelize - Sequelize library.
   * @returns {Promise<void>} Resolves once removed.
   */
  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('observations', {
      observation_id: OBSERVATIONS.map((r) => r.observation_id),
    });
  },
};

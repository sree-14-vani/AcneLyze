export type Language = 'en' | 'hi' | 'kn' | 'te';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegionMetrics {
  redness: number;
  breakouts: number;
  texture: number;
  shine: number;
}

export interface SkinRegion {
  id: 'forehead' | 'left_cheek' | 'right_cheek' | 'nose' | 'chin';
  label: string;
  box: Box;
  score: number;
  severity: string;
  primary_concern: string;
  concerns: string[];
  metrics: RegionMetrics;
  spots_detected: number;
  measurement_quality: string;
}

export interface AnalysisResult {
  overall_score: number;
  severity: string;
  regions: SkinRegion[];
  concerns: string[];
  focus_regions: string[];
  face_box?: Box;
  image_width?: number;
  image_height?: number;
  method?: string;
  disclaimer: string;
  input?: { width: number; height: number; format: string };
}

export interface VisibleRegion {
  id: SkinRegion['id'];
  score: number;
  concerns: string[];
  metrics: RegionMetrics;
  spots_detected?: number;
}

export interface VisibleAnalysis {
  overall_score?: number;
  concerns: string[];
  focus_regions: string[];
  regions?: VisibleRegion[];
}

export interface EnhancementResult {
  image: string;
  mime_type: string;
  width: number;
  height: number;
  method: string;
  mode_label: string;
  strength: number;
  gfpgan_weight?: number;
  face_detected: boolean;
  face_count?: number;
  face_box: Box;
  processing_ms: number;
  notes: string[];
  acne_specific_retouch?: { enabled: boolean; reason: string };
  disclaimer: string;
  input?: { width: number; height: number; format: string };
}

export interface Step {
  title: string;
  detail: string;
}

export interface TipPlan {
  morning: Step[];
  night: Step[];
  habits: string[];
  precautions: string[];
  focus: string[];
  focus_notes: string[];
  generator: 'gemini' | 'local_fallback' | 'rules';
  language: Language;
  notice: string;
}

export interface MealDay {
  day: string;
  breakfast: string;
  lunch: string;
  snacks: string;
  dinner: string;
}

export interface DietPlan {
  breakfast: string[];
  lunch: string[];
  snacks: string[];
  dinner: string[];
  hydration: { target_ml: number; tips: string[]; note: string };
  weekly_plan: MealDay[];
  avoid: string[];
  notes: string[];
  generator: 'gemini' | 'local_fallback' | 'rules';
  language: Language;
  notice: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface Profile {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  skin_type?: string;
  updated_at?: string;
}

export type DietType = 'vegetarian' | 'vegan' | 'eggetarian' | 'non_vegetarian';

export interface NotificationSettings {
  morning: boolean;
  night: boolean;
  water: boolean;
  meal: boolean;
  routine: boolean;
}

export interface Preferences {
  language: Language;
  diet_type: DietType;
  allergies: string[];
  skin_goals: string[];
  sensitivities: string[];
  current_routine: string;
  weight_kg: number | null;
  notifications: NotificationSettings;
}

export interface AnalysisRecord {
  id: string;
  user_id: string;
  overall_score: number;
  concerns: string[];
  focus_regions: string[];
  regions: SkinRegion[];
  thumbnail: string | null;
  created_at: string;
}

export interface EnhancementRecord {
  id: string;
  user_id: string;
  method: string;
  mode_label: string;
  strength: number;
  original_thumbnail: string | null;
  enhanced_thumbnail: string | null;
  notes: string[];
  created_at: string;
}

export interface PlanRecord<T> {
  id: string;
  user_id: string;
  plan: T;
  created_at: string;
}

export type ReminderCategory = 'medicine' | 'self_monitoring';
export type ReminderRepeat = 'never' | 'daily' | 'weekly' | 'custom';

export interface Reminder {
  id: string;
  user_id: string;
  category: ReminderCategory;
  title: string;
  times: string[]; // HH:MM 24h
  repeat: ReminderRepeat;
  weekdays: number[]; // 0=Sun..6=Sat, used for weekly
  custom_dates: string[]; // YYYY-MM-DD, used for custom
  enabled: boolean;
  next_at: string | null; // ISO local/UTC string
  last_notified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReminderNotificationLog {
  id: string;
  reminder_id: string;
  title: string;
  category: ReminderCategory;
  notified_at: string;
}

export interface RoutinePlan {
  morning: Step[];
  night: Step[];
  weekly_focus: string[];
  notes: string[];
  updated_at: string;
}

export interface ApiConfig {
  version: string;
  languages: { code: Language; label: string }[];
  limits: Record<string, number>;
  features: {
    gemini_chat: boolean;
    gfpgan: boolean;
    gfpgan_model?: string;
    acne_detection?: boolean;
    yolo_model?: string;
    skin_condition_classification?: boolean;
    skin_condition_model?: string;
    skin_condition_supported_classes?: string[];
    chat_available?: boolean;
    enhancement_fallback: string;
  };
  disclaimer: string;
}

export interface ApiErrorShape {
  error?: { code?: string; message?: string };
  detail?: string | { msg?: string };
}

export interface LesionDetection {
  class_id: number;
  label: string;
  confidence: number;
  box: Box;
  region: string | null;
  explanation: string;
}

export interface DetectionResult {
  method: string;
  checkpoint: string;
  model_classes: string[];
  confidence_threshold: number;
  iou_threshold: number;
  image_width: number;
  image_height: number;
  face_box: Box;
  image_quality: { blur_score: number; brightness: number; warnings: string[] };
  detections: LesionDetection[];
  total_detections: number;
  lesion_counts: Record<string, number>;
  detected_classes: string[];
  region_counts: Record<string, number>;
  region_boxes: Record<string, Box>;
  summary: string;
  class_explanations: Record<string, string>;
  disclaimer: string;
  input?: { width: number; height: number; format: string };
}

export interface DetectionStatus {
  yolo: string;
  yolo_active: boolean;
  checkpoint_present: boolean;
  checkpoint_path: string;
  expected_checkpoint: string;
  classes: string[];
  load_error: string | null;
  confidence_threshold: number;
  iou_threshold: number;
}

export interface ConditionPrediction {
  id: string;
  label: string;
  score: number;
  threshold: number;
  selected: boolean;
  explanation: string;
  caution: string;
}

export interface SkinConditionResult {
  method: string;
  status: 'classified' | 'uncertain';
  abstain_reason: string | null;
  checkpoint: string;
  label_map: string;
  supported_conditions: string[];
  activation: 'sigmoid' | 'softmax';
  primary_condition: { id: string; label: string; score: number | null; top_label?: string };
  conditions: string[];
  predictions: ConditionPrediction[];
  face_box: Box;
  image_quality: { blur_score: number; brightness: number; warnings: string[] };
  validation: Record<string, unknown>;
  calibrated: boolean;
  limitations: string[];
  summary: string;
  disclaimer: string;
  input?: { width: number; height: number; format: string };
}

export interface SkinConditionStatus {
  status: 'active' | 'unavailable';
  active: boolean;
  reason: string;
  message: string;
  checkpoint_present: boolean;
  checkpoint_path: string;
  expected_checkpoint: string;
  label_map_present: boolean;
  label_map_path: string;
  supported_conditions: string[];
  candidate_conditions: { id: string; label: string }[];
  requested_conditions?: { id: string; label: string }[];
  unsupported_requested_conditions?: { id: string; label: string; reason: string }[];
  abstain_label: string;
  threshold: number;
  validation: Record<string, unknown>;
  calibrated: boolean;
  load_error: string | null;
}

export interface SkinDiseaseAnalysisResult {
  analysis: AnalysisResult;
  detection: DetectionResult | null;
  detection_error: { code: string; message: string } | null;
  condition: SkinConditionResult | null;
  condition_error: { code: string; message: string } | null;
  input?: { width: number; height: number; format: string };
}

// Backward-compatible alias for older code paths; prefer SkinDiseaseAnalysisResult.
export type SkinConditionAnalysis = SkinDiseaseAnalysisResult;



export interface ProductItem {
  id: string;
  name: string;
  brand: string;
  category: string;
  ingredients: string[];
  benefits: string;
  suitable_skin_types: string[];
  usage: string;
  precautions: string;
  image_url: string | null;
  purchase_url: string | null;
  source_url?: string | null;
  source_name?: string | null;
  price: string | null;
  source_note: string;
  reason?: string;
  active_ingredients?: string[];
}

export interface ProductCatalog {
  products: ProductItem[];
  by_category: Record<string, ProductItem[]>;
  count: number;
  filters: Record<string, unknown>;
  notices: string[];
  disclaimer: string;
}

export interface ProduceItem {
  id: string;
  name: string;
  nutrients: string[];
  benefits: string;
  serving: string;
  alternatives: string[];
  warnings?: string;
  preparation?: string;
  tags: string[];
  image_url: string | null;
  source_url?: string | null;
  source_name?: string | null;
  source_note?: string;
  matched_tags?: string[];
  personalised_note?: string;
}

export interface ProduceCatalog {
  kind: 'fruit' | 'vegetable';
  items: ProduceItem[];
  count: number;
  available_filters: string[];
  notices: string[];
  personalisation?: { focus_tags: string[]; excluded_terms: string[] };
}

export interface RecommendationInput {
  analysis: VisibleAnalysis | null;
  detection: DetectionResult | null;
  preferences: {
    skin_type: string;
    goals: string[];
    sensitivities: string[];
    current_routine: string;
    diet_type: DietType;
    allergies: string[];
    dislikes: string[];
    weight_kg: number | null;
    meals_per_day: number;
  };
  language: Language;
}

export interface RecommendationResponse {
  products: ProductCatalog;
  fruits: ProduceCatalog;
  vegetables: ProduceCatalog;
  tips: TipPlan | null;
  diet: DietPlan | null;
  errors: Record<string, string>;
  basis: Record<string, unknown>;
  disclaimer: string;
}

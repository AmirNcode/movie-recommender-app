export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      movies_cache: {
        Row: {
          cached_at: string
          director: string | null
          genre: string | null
          original_language: string | null
          popularity: number | null
          poster_url: string | null
          release_date: string | null
          source_tier: string | null
          synopsis: string | null
          title: string
          tmdb_movie_id: number
          top_actors: string[]
          updated_at: string
          vote_average: number | null
          vote_count: number | null
          watch_providers: Json | null
          watch_providers_fetched_at: string | null
          year: number | null
        }
        Insert: {
          cached_at?: string
          director?: string | null
          genre?: string | null
          original_language?: string | null
          popularity?: number | null
          poster_url?: string | null
          release_date?: string | null
          source_tier?: string | null
          synopsis?: string | null
          title: string
          tmdb_movie_id: number
          top_actors?: string[]
          updated_at?: string
          vote_average?: number | null
          vote_count?: number | null
          watch_providers?: Json | null
          watch_providers_fetched_at?: string | null
          year?: number | null
        }
        Update: {
          cached_at?: string
          director?: string | null
          genre?: string | null
          original_language?: string | null
          popularity?: number | null
          poster_url?: string | null
          release_date?: string | null
          source_tier?: string | null
          synopsis?: string | null
          title?: string
          tmdb_movie_id?: number
          top_actors?: string[]
          updated_at?: string
          vote_average?: number | null
          vote_count?: number | null
          watch_providers?: Json | null
          watch_providers_fetched_at?: string | null
          year?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string | null
          id: string
          name: string | null
        }
        Insert: {
          created_at?: string | null
          id: string
          name?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string | null
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          count: number | null
          key: string
          window_start: string | null
        }
        Insert: {
          count?: number | null
          key: string
          window_start?: string | null
        }
        Update: {
          count?: number | null
          key?: string
          window_start?: string | null
        }
        Relationships: []
      }
      shared_recommendations: {
        Row: {
          created_at: string
          id: string
          movie_title: string
          movie_year: number | null
          poster_url: string | null
          reason: string | null
          tmdb_movie_id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          movie_title: string
          movie_year?: number | null
          poster_url?: string | null
          reason?: string | null
          tmdb_movie_id: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          movie_title?: string
          movie_year?: number | null
          poster_url?: string | null
          reason?: string | null
          tmdb_movie_id?: number
          user_id?: string
        }
        Relationships: []
      }
      swipe_events: {
        Row: {
          action: Database["public"]["Enums"]["swipe_action"]
          created_at: string
          id: string
          movie_director: string | null
          movie_genre: string | null
          movie_synopsis: string | null
          movie_title: string | null
          movie_year: number | null
          poster_url: string | null
          recommendation_reason: string | null
          source: string | null
          tmdb_movie_id: number
          user_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["swipe_action"]
          created_at?: string
          id?: string
          movie_director?: string | null
          movie_genre?: string | null
          movie_synopsis?: string | null
          movie_title?: string | null
          movie_year?: number | null
          poster_url?: string | null
          recommendation_reason?: string | null
          source?: string | null
          tmdb_movie_id: number
          user_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["swipe_action"]
          created_at?: string
          id?: string
          movie_director?: string | null
          movie_genre?: string | null
          movie_synopsis?: string | null
          movie_title?: string | null
          movie_year?: number | null
          poster_url?: string | null
          recommendation_reason?: string | null
          source?: string | null
          tmdb_movie_id?: number
          user_id?: string
        }
        Relationships: []
      }
      swipe_states: {
        Row: {
          id: string
          latest_action: Database["public"]["Enums"]["swipe_action"]
          tmdb_movie_id: number
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: string
          latest_action: Database["public"]["Enums"]["swipe_action"]
          tmdb_movie_id: number
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: string
          latest_action?: Database["public"]["Enums"]["swipe_action"]
          tmdb_movie_id?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_movie_queue: {
        Row: {
          consumed_at: string | null
          created_at: string
          discarded_at: string | null
          id: string
          queue_rank: number
          source_tier: string | null
          tmdb_movie_id: number
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          discarded_at?: string | null
          id?: string
          queue_rank: number
          source_tier?: string | null
          tmdb_movie_id: number
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          discarded_at?: string | null
          id?: string
          queue_rank?: number
          source_tier?: string | null
          tmdb_movie_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_movie_queue_tmdb_movie_id_fkey"
            columns: ["tmdb_movie_id"]
            isOneToOne: false
            referencedRelation: "movies_cache"
            referencedColumns: ["tmdb_movie_id"]
          },
        ]
      }
      watchlists: {
        Row: {
          created_at: string | null
          id: string
          movie_director: string | null
          movie_genre: string | null
          movie_synopsis: string | null
          movie_title: string | null
          movie_year: number | null
          poster_url: string | null
          recommendation_reason: string | null
          recommended_at: string | null
          source: string | null
          tmdb_movie_id: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          movie_director?: string | null
          movie_genre?: string | null
          movie_synopsis?: string | null
          movie_title?: string | null
          movie_year?: number | null
          poster_url?: string | null
          recommendation_reason?: string | null
          recommended_at?: string | null
          source?: string | null
          tmdb_movie_id: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          movie_director?: string | null
          movie_genre?: string | null
          movie_synopsis?: string | null
          movie_title?: string | null
          movie_year?: number | null
          poster_url?: string | null
          recommendation_reason?: string | null
          recommended_at?: string | null
          source?: string | null
          tmdb_movie_id?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_rate_limit: {
        Args: {
          ip_action_key: string
          max_reqs: number
          window_interval: string
        }
        Returns: Json
      }
      enqueue_user_movies: {
        Args: { p_movies: Json; p_user_id: string }
        Returns: number
      }
      record_swipe_event: {
        Args: {
          p_action: Database["public"]["Enums"]["swipe_action"]
          p_movie_director?: string
          p_movie_genre?: string
          p_movie_synopsis?: string
          p_movie_title?: string
          p_movie_year?: number
          p_poster_url?: string
          p_recommendation_reason?: string
          p_source?: string
          p_tmdb_movie_id: number
        }
        Returns: boolean
      }
    }
    Enums: {
      swipe_action: "unwatched" | "watched" | "loved" | "disliked"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      swipe_action: ["unwatched", "watched", "loved", "disliked"],
    },
  },
} as const

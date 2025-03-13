import * as apiClient from '../apiClient';
import { EQProfile } from '../../models/EQProfile';
import { EQBand } from '../../models/EQBand';

// API endpoints
const EQ_PROFILES_ENDPOINT = '/eq-profiles';
const ACTIVE_PROFILE_ENDPOINT = '/eq-profiles/active';

// Interface for EQ profile response from API
interface EQProfileResponse {
  id: string;
  name: string;
  bands: EQBand[];
  volume: number;
  lastModified: number;
}

// Check if an EQ profile exists on the server
export const checkEQProfileExists = async (profileId: string): Promise<boolean> => {
  try {
    await apiClient.get<EQProfileResponse>(`${EQ_PROFILES_ENDPOINT}/${profileId}`);
    return true;
  } catch (error) {
    if (error instanceof apiClient.ApiError && error.status === 404) {
      return false;
    }
    throw error;
  }
};

// Get an EQ profile by ID
export const getEQProfile = async (profileId: string): Promise<EQProfile> => {
  const response = await apiClient.get<EQProfileResponse>(`${EQ_PROFILES_ENDPOINT}/${profileId}`);
  
  return {
    ...response,
    syncStatus: 'synced'
  };
};

// Get all EQ profiles
export const getAllEQProfiles = async (): Promise<EQProfile[]> => {
  const response = await apiClient.get<EQProfileResponse[]>(EQ_PROFILES_ENDPOINT);
  
  return response.map(profile => ({
    ...profile,
    syncStatus: 'synced'
  }));
};

// Get EQ profiles updated since a specific time
export const getEQProfilesUpdatedSince = async (timestamp: number): Promise<EQProfile[]> => {
  const response = await apiClient.get<EQProfileResponse[]>(
    `${EQ_PROFILES_ENDPOINT}?updatedSince=${timestamp}`
  );
  
  return response.map(profile => ({
    ...profile,
    syncStatus: 'synced'
  }));
};

// Create a new EQ profile
export const createEQProfile = async (profile: EQProfile): Promise<EQProfile> => {
  const response = await apiClient.post<EQProfileResponse>(EQ_PROFILES_ENDPOINT, {
    id: profile.id,
    name: profile.name,
    bands: profile.bands,
    volume: profile.volume
  });
  
  return {
    ...response,
    syncStatus: 'synced'
  };
};

// Update an existing EQ profile
export const updateEQProfile = async (profile: EQProfile): Promise<EQProfile> => {
  const response = await apiClient.put<EQProfileResponse>(
    `${EQ_PROFILES_ENDPOINT}/${profile.id}`,
    {
      name: profile.name,
      bands: profile.bands,
      volume: profile.volume
    }
  );
  
  return {
    ...response,
    syncStatus: 'synced'
  };
};

// Delete an EQ profile
export const deleteEQProfile = async (profileId: string): Promise<void> => {
  await apiClient.del(`${EQ_PROFILES_ENDPOINT}/${profileId}`);
};

// Get the active EQ profile ID
export const getActiveEQProfile = async (): Promise<string | null> => {
  try {
    const response = await apiClient.get<{ profileId: string | null }>(ACTIVE_PROFILE_ENDPOINT);
    return response.profileId;
  } catch (error) {
    console.error('Error getting active EQ profile:', error);
    return null;
  }
};

// Set the active EQ profile ID
export const setActiveEQProfile = async (profileId: string | null): Promise<void> => {
  await apiClient.put(ACTIVE_PROFILE_ENDPOINT, { profileId });
}; 